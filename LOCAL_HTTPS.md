# Private HTTPS for an iPhone on the home network

Lumen's reading and note tools can tolerate a plain LAN HTTP address, but the
PWA, WebGPU model, persistent storage, and AI prompt transport require a secure
browser context. This setup creates a private certificate authority (CA) on the
Mac and a short-lived server certificate valid for the Mac's current LAN IPv4
address and, when supplied, a stable LAN hostname. It has no subscription or
API cost and does not expose Lumen to the public internet.

## Choose a stable browser origin first

Safari treats every scheme, host, and port combination as a separate origin.
Lumen's installed PWA, model cache, IndexedDB notes, permissions, and other local
browser data belong to that exact origin. If the Mac's DHCP address changes,
opening the replacement IP looks like a different app and the old-origin data
appears missing even though Safari has not necessarily deleted it.

Before installing Lumen, either reserve the Mac's IPv4 address in the home
router or use a stable LAN hostname that the iPhone can resolve, such as the
Mac's `.local` Bonjour name. A stable hostname is preferable because it keeps
the browser origin unchanged after a DHCP address change. Do not alternate
between the hostname, LAN IP, `localhost`, or different ports after setup.

## Generate the certificates

Find the Mac's Wi-Fi address, then generate a new CA once:

```bash
ipconfig getifaddr en0
sh scripts/create_local_https.sh 192.168.1.13 macbook-pro.local
```

Replace the examples with the Mac's address and resolvable Bonjour hostname.
The hostname argument is optional when the router permanently reserves the IP.
The certificate always includes the requested IP, `127.0.0.1`, and `localhost`.

The script stages and verifies the CA, leaf certificate, key match, and subject
alternative names before installing them. It refuses to overwrite an existing
CA. It stores private keys under `.local/https/`, stores its explicit serial
state there, and puts only the public root certificate at
`public/lumen-local-ca.cer`. Never send, upload, commit, or serve either
`*-key.pem` file.

Build after generating so the public `.cer` file is available from the HTTP
copy of Lumen, then run the HTTPS server using the paths printed by the script:

```bash
npm run build
TLS_CERT_FILE=.local/https/server-cert.pem \
TLS_KEY_FILE=.local/https/server-key.pem \
AI_ALLOWED_ORIGINS=https://macbook-pro.local:4194 \
HOST=0.0.0.0 PORT=4194 npm start
```

`AI_ALLOWED_ORIGINS` must exactly match the stable Safari origin selected
above, including scheme and port. Use the reserved IP origin there only when
that is the origin you intend to keep using.

Keep this restricted to a trusted private network. The certificate encrypts
traffic and authenticates this Mac after the iPhone trusts the CA; it does not
add accounts, public exposure, or authorization between people already on that
network.

## Trust the public CA on the iPhone

First record the expected SHA-256 fingerprint on the Mac through a trusted
screen/terminal path:

```bash
openssl x509 -in .local/https/ca-cert.pem -noout -fingerprint -sha256
```

The safest transfer is to AirDrop `public/lumen-local-ca.cer` from this Mac to
your iPhone. AirDrop avoids bootstrapping a device-wide trust anchor from an
unauthenticated HTTP download. If AirDrop is unavailable, the temporary
`http://<Mac-IP>:<HTTP-port>/lumen-local-ca.cer` route is a convenience only on
a private network you control; HTTP cannot authenticate the CA file.

1. Transfer the public `.cer` with AirDrop, or use the HTTP route only on that
   trusted network. Never transfer either private `*-key.pem` file.
2. Open Settings and install **Lumen Local Learning CA** when iOS prompts you.
   Before enabling TLS trust, open the installed profile/certificate details
   and compare its SHA-256 fingerprint with the value shown on the Mac. Remove
   the profile immediately if any byte differs.
3. Go to **Settings → General → About → Certificate Trust Settings** and enable
   full trust for **Lumen Local Learning CA**.
4. Open `https://macbook-pro.local:4194/` if that is the stable name placed in
   the certificate, or the reserved `https://<Mac-IP>:4194/` otherwise. Confirm
   Safari shows a trusted connection, then use Share → Add to Home Screen. Keep
   using that same origin.

Apple documents that a manually installed root is not automatically trusted for
TLS and must be enabled under Certificate Trust Settings:
https://support.apple.com/en-us/102390

## Keep the CA signing key offline

The running server needs `.local/https/server-key.pem`; it does not need
`.local/https/ca-key.pem`. After setup, copy the CA key to encrypted offline
storage and remove the working copy from the Mac. Restore it temporarily to the
same path only when issuing a replacement leaf, then return it offline. Keep a
separate encrypted backup: losing the CA key prevents renewal under the root
already installed on the iPhone, while disclosure lets an attacker mint
certificates trusted by every device on which this CA is enabled.

The public CA certificate and its displayed fingerprint are not secrets. The
server private key and CA private key are secrets; never expose them through
Lumen, AirDrop, email, cloud sync, or source control.

## Renew the server certificate

The server certificate is valid for 397 days. Restore the matching CA private
key if it is offline, then renew before expiry or after the Mac's LAN address
changes:

```bash
sh scripts/create_local_https.sh --renew 192.168.1.13 macbook-pro.local
```

Use the current address and the same stable hostname. Renewal takes an
exclusive operation lock, validates the existing CA/key pair, advances an
explicit serial file, stages and verifies the new leaf, and replaces only the
server leaf files with rollback protection. It can also recover a missing or
corrupt server leaf as long as the CA certificate and private key are present.
The CA certificate and its fingerprint remain unchanged, so the iPhone profile
does not need reinstalling. Restart `npm start` after renewal so the server
loads the new certificate. A stable hostname also keeps the Safari origin
unchanged when only the DHCP IP changes.

If the CA itself is near expiry, compromised, or unavailable, create a new CA
only as a deliberate trust rotation: remove the old iPhone profile, securely
replace the local trust material, and repeat fingerprint verification. The
renewal command intentionally refuses to create or silently substitute a CA.

## Remove private trust

To revoke this private trust, remove **Lumen Local Learning CA** from the
iPhone, disable its full-trust toggle if still shown, and stop the HTTPS server.
Removing the public `.cer` download does not remove a profile already installed
on the iPhone. Also delete any exported CA private-key backups you intentionally
wish to revoke; deleting only the server certificate does not revoke the root.
