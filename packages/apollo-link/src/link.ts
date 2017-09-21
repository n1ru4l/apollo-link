import Observable from 'zen-observable-ts';

import {
  GraphQLRequest,
  NextLink,
  Operation,
  RequestHandler,
  FetchResult,
} from './types';

import {
  validateOperation,
  isTerminating,
  LinkError,
  transformOperation,
} from './linkUtils';

const passthrough = (op, forward) => (forward ? forward(op) : Observable.of());

const toLink = (handler: RequestHandler | ApolloLink) =>
  typeof handler === 'function' ? new ApolloLink(handler) : handler;

export const empty = (): ApolloLink =>
  new ApolloLink((op, forward) => Observable.of());

export const fold = (links: ApolloLink[]): ApolloLink => {
  if (links.length === 0) return empty();

  return links.map(toLink).reduce((x, y) => x.concat(y));
};

export const split = (
  test: (op: Operation) => boolean,
  left: ApolloLink | RequestHandler,
  right: ApolloLink | RequestHandler = new ApolloLink(passthrough),
): ApolloLink => {
  const leftLink = toLink(left);
  const rightLink = toLink(right);

  if (isTerminating(leftLink) && isTerminating(rightLink)) {
    return new ApolloLink(operation => {
      return test(operation)
        ? leftLink.request(operation) || Observable.of()
        : rightLink.request(operation) || Observable.of();
    });
  } else {
    return new ApolloLink((operation, forward) => {
      return test(operation)
        ? leftLink.request(operation, forward) || Observable.of()
        : rightLink.request(operation, forward) || Observable.of();
    });
  }
};

// join two Links together
export const concat = (
  first: ApolloLink | RequestHandler,
  second: ApolloLink | RequestHandler,
) => {
  const firstLink = toLink(first);
  if (isTerminating(firstLink)) {
    console.warn(
      new LinkError(
        `You are calling concat on a terminating link, which will have no effect`,
        firstLink,
      ),
    );
    return firstLink;
  }
  const nextLink = toLink(second);

  if (isTerminating(nextLink)) {
    return new ApolloLink(
      operation =>
        firstLink.request(
          operation,
          op => nextLink.request(op) || Observable.of(),
        ) || Observable.of(),
    );
  } else {
    return new ApolloLink((operation, forward) => {
      return (
        firstLink.request(operation, op => {
          return nextLink.request(op, forward) || Observable.of();
        }) || Observable.of()
      );
    });
  }
};

// XXX add in type support for context manipulation
// XXX remove mutability of context
export class ApolloLink {
  constructor(request?: RequestHandler) {
    if (request) this.request = request;
  }

  public static empty = empty;
  // XXX should we deprecate from in favor of fold?
  public static from = fold;
  public static fold = fold;
  public static split = split;

  public split(
    test: (op: Operation) => boolean,
    left: ApolloLink | RequestHandler,
    right: ApolloLink | RequestHandler = new ApolloLink(passthrough),
  ): ApolloLink {
    return this.concat(split(test, left, right));
  }

  public concat(next: ApolloLink | RequestHandler): ApolloLink {
    return concat(this, next);
  }

  public request(
    operation: Operation,
    forward?: NextLink,
  ): Observable<FetchResult> | null {
    throw new Error('request is not implemented');
  }
}

export function execute(
  link: ApolloLink,
  operation: GraphQLRequest,
): Observable<FetchResult> {
  const copy = { context: {}, variables: {}, ...operation };
  validateOperation(copy);

  return link.request(transformOperation(copy)) || Observable.of();
}