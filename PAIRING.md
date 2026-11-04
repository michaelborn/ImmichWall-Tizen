# TV pairing v1

## User flow

1. A Tizen TV requests a pairing session and displays a random five-digit PIN plus `https://immichwall.theborns.xyz/pair`.
2. The phone page asks only for the PIN first. `verify-pin` confirms the PIN without consuming it; wrong attempts count against the browser's PIN-attempt lockout.
3. Once the PIN is verified, the phone page moves to a second screen for the Immich server URL and API key. It never requests an Immich username or password. Submitting them claims the PIN.
4. The pairing service associates the connection with that TV's unguessable session ID and returns a separate handoff token to the browser. The TV polls its own session and receives the connection over the LAN-facing service.
5. The TV validates image-search access directly with Immich and saves the connection in Tizen KeyManager. Validation failures are reported back to the phone, which shows them in red. Only after KeyManager reports success does the TV acknowledge the session.
6. Acknowledgement erases the API key and server URL from the pending service session. The TV sends Immich photo and thumbnail requests directly to Immich; the pairing service does not proxy them.

The phone can update the server URL or key during the one-hour handoff, without another PIN. Each update increments a revision and clears any reported error; the TV must validate and save the latest revision before it can acknowledge. A Start-over link clears the handoff and returns the phone to the PIN screen.

## Limits and operation

- PINs expire after five minutes and are consumed on a successful claim.
- Five incorrect PIN submissions block that browser/IP fingerprint for 15 minutes. The block does not invalidate or affect another TV's PIN.
- Handoffs expire after one hour. PINs, pending credentials, and handoffs are held in process memory only; a service restart requires the TV to request a new PIN.
- Tizen credentials are stored with `tizen.keymanager` under the app's KeyManager alias and are removed by **Unpair**. If the KeyManager API is unavailable on a device, the app falls back to the WebApp's local storage so pairing and reconnection still work (less protected than the secure repository).
- TV detection uses the KeyManager API or a SMART-TV/Tizen user-agent, so an unpaired TV always shows the PIN screen; the Immich URL and API key can only be entered on the paired phone page, never on the TV itself.
- The desktop web slideshow continues to accept a manually entered API key through its own settings/connection screen.
- Pairing is designed for the LAN-only SWAG deployment. The pairing page and API do not add a separate user login.

## Endpoints

- `POST /api/pairing/sessions` — TV creates a session and receives `sessionId`, `pin`, and expiry.
- `POST /api/pairing/verify-pin` — phone verifies the PIN before entering credentials; does not consume it.
- `POST /api/pairing/claim` — phone claims the PIN and receives a handoff token.
- `GET /api/pairing/sessions/:sessionId` — TV polls for a claim and receives connection data only after the phone claims the PIN.
- `POST /api/pairing/update` — phone updates connection details using the handoff token.
- `POST /api/pairing/session-error` — TV reports a validation or KeyManager error so the phone shows it in red.
- `POST /api/pairing/handoff-status` — phone checks whether the TV acknowledged pairing or reported an error.
- `POST /api/pairing/acknowledge` — TV confirms the latest saved revision and triggers secret erasure.

Every pairing response is marked `Cache-Control: no-store`. The handoff token is held in the browser tab's session storage; the API key is not written to browser storage. The TV's Immich key is sent to the TV only over its unguessable session ID and is erased when pairing is acknowledged or expires.

## Later ideas (not part of v1)

- Have the service create/revoke a dedicated Immich API key for each TV.
- Persist TV metadata and pairing status in a registry.
- Consider proxying Immich traffic only if direct TV access proves impractical.
- Make the pairing URL configurable for self-hosted deployments.
