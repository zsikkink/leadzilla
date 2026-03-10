export class DiscoveryAdminNotFoundError extends Error {
  constructor(message = 'Record not found') {
    super(message);
    this.name = 'DiscoveryAdminNotFoundError';
  }
}

export class DiscoveryAdminNotImplementedError extends Error {
  constructor(message = 'Discovery admin dependency is not configured') {
    super(message);
    this.name = 'DiscoveryAdminNotImplementedError';
  }
}

export class DiscoveryAdminBadRequestError extends Error {
  constructor(message = 'Bad request') {
    super(message);
    this.name = 'DiscoveryAdminBadRequestError';
  }
}
