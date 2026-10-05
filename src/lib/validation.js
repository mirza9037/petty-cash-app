import { z } from 'zod'
import { toPaisa } from './money.js'
import { SECTIONS, today } from './domain.js'
const money = z.union([z.string(), z.number()]).transform((value, ctx) => {
  try {
    return toPaisa(value) / 100
  } catch (error) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: error.message })
    return z.NEVER
  }
})
const nonnegativeMoney = money.refine((value) => value >= 0, 'Amount cannot be negative.')
export const reportSchema = z.object({
  report_date: z
    .string()
    .refine(
      (value) =>
        /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        !Number.isNaN(Date.parse(value)) &&
        new Date(value).toISOString().slice(0, 10) === value,
      'Enter a valid report date.',
    ),
  prev_balance: money,
  cash_received: nonnegativeMoney,
  status: z.enum(['draft', 'submitted']),
}).refine((report) => report.status !== 'submitted' || report.report_date <= today(), {
  message: 'Submitted report date cannot be in the future (Karachi time).',
  path: ['report_date'],
})
export const lineItemSchema = z.object({
  description: z.string().trim().min(1, 'Description is required.').max(500),
  section: z.enum(SECTIONS),
  category: z.string().trim().min(1, 'Category is required.').max(100),
  amount: nonnegativeMoney,
})
export const lineItemsSchema = z
  .array(lineItemSchema)
  .min(1, 'At least one line item is required.')
  .max(100, 'Cannot exceed 100 line items.')
export function validate(schema, data) {
  const result = schema.safeParse(data)
  if (result.success) return { success: true, data: result.data }
  const issue = result.error.issues[0]
  return {
    success: false,
    error:
      (typeof issue.path[0] === 'number' ? 'Row ' + (issue.path[0] + 1) + ': ' : '') +
      issue.message,
  }
}
