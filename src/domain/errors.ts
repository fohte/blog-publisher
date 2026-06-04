export type ErrorCode =
  | 'TitleMissing'
  | 'DateInvalid'
  | 'SlugRequired'
  | 'WikiLinkUnresolved'
  | 'UnsupportedSyntax'
  | 'ImageUploadFailed'
  | 'NoteDecryptFailed'
  | 'ButtonValueOverflow'

export class DomainError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'DomainError'
  }
}
