import type { TextTemplate, Expr } from "../script-types.js";
import { ExprBuilder } from "./expressions.js";

export function t(strings: TemplateStringsArray, ...values: Array<ExprBuilder | string | number>): TextTemplate {
  const result: TextTemplate = [];
  for (let i = 0; i < strings.length; i++) {
    if (strings[i] !== "") {
      result.push(strings[i]);
    }
    if (i < values.length) {
      const val = values[i];
      if (val instanceof ExprBuilder) {
        result.push(val.toExpr());
      } else {
        result.push({ type: "literal", value: val } as Expr);
      }
    }
  }
  return result;
}
