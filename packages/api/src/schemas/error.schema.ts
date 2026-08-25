/**
 * Standard error response schema (design §7).
 *
 * Every error is serialized as:
 *   { "error": { "code": "ERROR_CODE", "message": "..." } }
 */

export const errorResponseSchema = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
      },
    },
  },
  required: ['error'],
} as const;