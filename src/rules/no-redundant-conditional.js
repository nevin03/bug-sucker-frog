"use strict";

/**
 * Flags conditionals that add no value:
 *   if (c) { return true } else { return false }   -> return Boolean(c)
 *   if (c) return true; return false;               -> return Boolean(c)
 *   c ? true : false                                -> Boolean(c)
 *   if (c) { A } else { A }  /  c ? x : x           -> identical branches
 *   if (c) {} else { A }                            -> empty if branch
 *   if (a) { if (b) { A } }                         -> if (a && b) { A }
 *   else { if (c) { A } }                           -> else if (c) { A }
 */

function unwrapSingle(stmt) {
  if (stmt && stmt.type === "BlockStatement" && stmt.body.length === 1) return stmt.body[0];
  return stmt;
}

function booleanReturn(stmt) {
  const s = unwrapSingle(stmt);
  if (s && s.type === "ReturnStatement" && s.argument && s.argument.type === "Literal" && typeof s.argument.value === "boolean") {
    return s.argument.value;
  }
  return null;
}

function isBoolLiteral(node) {
  return node.type === "Literal" && typeof node.value === "boolean";
}

function isEmptyBlock(stmt) {
  return stmt.type === "EmptyStatement" || (stmt.type === "BlockStatement" && stmt.body.length === 0);
}

module.exports = {
  meta: {
    type: "suggestion",
    docs: { description: "Disallow redundant if/else and ternary expressions" },
    schema: [
      {
        type: "object",
        properties: { checkCollapsibleIf: { type: "boolean" } },
        additionalProperties: false,
      },
    ],
    messages: {
      booleanReturn: "Redundant if/else returning boolean literals. Return `{{expr}}` directly.",
      booleanTernary: "Redundant ternary `? {{a}} : {{b}}`. Use `{{expr}}` directly.",
      identicalBranches: "Both branches of this conditional are identical; the condition is pointless.",
      emptyConsequent: "Empty `if` block with an `else`. Invert the condition and drop the empty branch.",
      collapsibleIf: "Nested `if` without `else` can be merged into the parent condition using `&&`.",
      lonelyIfInElse: "`if` as the only statement inside `else` should be written as `else if`.",
    },
  },

  create(context) {
    const source = context.sourceCode || context.getSourceCode();
    const { checkCollapsibleIf = true } = context.options[0] || {};
    const text = (n) => source.getText(n);
    const sameCode = (a, b) => text(a).replace(/\s+/g, "") === text(b).replace(/\s+/g, "");

    return {
      IfStatement(node) {
        const { test, consequent, alternate } = node;

        // if (c) return true; else return false;
        if (alternate) {
          const a = booleanReturn(consequent);
          const b = booleanReturn(alternate);
          if (a !== null && b !== null) {
            if (a === b) {
              context.report({ node, messageId: "identicalBranches" });
            } else {
              const expr = a ? `Boolean(${text(test)})` : `!(${text(test)})`;
              context.report({ node, messageId: "booleanReturn", data: { expr } });
            }
            return;
          }
        }

        // if (c) return true; return false;   (no else, next sibling returns opposite)
        if (!alternate && node.parent && Array.isArray(node.parent.body)) {
          const siblings = node.parent.body;
          const next = siblings[siblings.indexOf(node) + 1];
          const a = booleanReturn(consequent);
          const b = next && booleanReturn(next);
          if (a !== null && b !== null && b !== undefined && a !== b) {
            const expr = a ? `Boolean(${text(test)})` : `!(${text(test)})`;
            context.report({ node, messageId: "booleanReturn", data: { expr } });
            return;
          }
        }

        if (alternate && alternate.type !== "IfStatement" && sameCode(consequent, alternate)) {
          context.report({ node, messageId: "identicalBranches" });
          return;
        }

        if (alternate && isEmptyBlock(consequent)) {
          context.report({ node: consequent, messageId: "emptyConsequent" });
        }

        if (
          alternate &&
          alternate.type === "BlockStatement" &&
          alternate.body.length === 1 &&
          alternate.body[0].type === "IfStatement" &&
          source.getCommentsInside(alternate).length === 0
        ) {
          context.report({ node: alternate.body[0], messageId: "lonelyIfInElse" });
        }

        if (checkCollapsibleIf && !alternate) {
          const inner = unwrapSingle(consequent);
          if (inner && inner.type === "IfStatement" && !inner.alternate) {
            context.report({ node: inner, messageId: "collapsibleIf" });
          }
        }
      },

      ConditionalExpression(node) {
        const { test, consequent, alternate } = node;
        if (isBoolLiteral(consequent) && isBoolLiteral(alternate) && consequent.value !== alternate.value) {
          const expr = consequent.value ? `Boolean(${text(test)})` : `!(${text(test)})`;
          context.report({
            node,
            messageId: "booleanTernary",
            data: { a: String(consequent.value), b: String(alternate.value), expr },
          });
          return;
        }
        if (sameCode(consequent, alternate)) {
          context.report({ node, messageId: "identicalBranches" });
        }
      },
    };
  },
};
