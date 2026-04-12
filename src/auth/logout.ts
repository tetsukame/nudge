export type EndSessionOptions = {
  endSessionEndpoint: string;
  idTokenHint: string | undefined;
  postLogoutRedirectUri: string;
  clientId: string;
};

/**
 * Build the Keycloak RP-initiated logout URL.
 * See: https://openid.net/specs/openid-connect-rpinitiated-1_0.html
 */
export function buildEndSessionUrl(opts: EndSessionOptions): string {
  const u = new URL(opts.endSessionEndpoint);
  u.searchParams.set('post_logout_redirect_uri', opts.postLogoutRedirectUri);
  u.searchParams.set('client_id', opts.clientId);
  if (opts.idTokenHint) {
    u.searchParams.set('id_token_hint', opts.idTokenHint);
  }
  return u.toString();
}
