export class IcpNotImplementedError extends Error {
  constructor(message = 'ICP module is not implemented yet') {
    super(message);
    this.name = 'IcpNotImplementedError';
  }
}

export class IcpNotFoundError extends Error {
  constructor(message = 'ICP profile not found') {
    super(message);
    this.name = 'IcpNotFoundError';
  }
}

export class IcpBadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IcpBadRequestError';
  }
}
