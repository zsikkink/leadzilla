export class MessagingNotImplementedError extends Error {
  constructor(message = 'Messaging module is not implemented yet') {
    super(message);
    this.name = 'MessagingNotImplementedError';
  }
}

export class MessagingNotFoundError extends Error {
  constructor(message = 'Messaging record not found') {
    super(message);
    this.name = 'MessagingNotFoundError';
  }
}

export class MessagingDraftGenerationIneligibleError extends Error {
  constructor(message = 'Lead is not eligible for draft generation') {
    super(message);
    this.name = 'MessagingDraftGenerationIneligibleError';
  }
}

export class MessagingDraftGenerationUnavailableError extends Error {
  constructor(message = 'Draft generation is temporarily unavailable') {
    super(message);
    this.name = 'MessagingDraftGenerationUnavailableError';
  }
}

export class MessagingSendIneligibleError extends Error {
  constructor(message = 'Message send is not allowed for the current draft state') {
    super(message);
    this.name = 'MessagingSendIneligibleError';
  }
}
