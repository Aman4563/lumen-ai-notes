#!/bin/sh
set -eu

usage() {
  cat >&2 <<'EOF'
Usage:
  sh scripts/create_local_https.sh <Mac-LAN-IPv4> [stable-DNS-name]
  sh scripts/create_local_https.sh --renew <Mac-LAN-IPv4> [stable-DNS-name]
EOF
}

mode=create
if [ "${1:-}" = "--renew" ]; then
  mode=renew
  shift
fi

lan_ip=${1:-}
stable_dns=${2:-}
if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  usage
  exit 2
fi

validate_ipv4() (
  value=$1
  case "$value" in
    ''|*[!0-9.]*) exit 1 ;;
  esac
  previous_ifs=$IFS
  IFS=.
  set -- $value
  IFS=$previous_ifs
  [ "$#" -eq 4 ] || exit 1
  for octet in "$@"; do
    case "$octet" in
      0|[1-9]|[1-9][0-9]|[1-9][0-9][0-9]) ;;
      *) exit 1 ;;
    esac
    [ "$octet" -le 255 ] || exit 1
  done
)

validate_dns_name() (
  value=$1
  [ -n "$value" ] || exit 0
  [ "${#value}" -le 253 ] || exit 1
  case "$value" in
    *[!A-Za-z0-9.-]*|.*|*.|*..*) exit 1 ;;
  esac
  previous_ifs=$IFS
  IFS=.
  set -- $value
  IFS=$previous_ifs
  [ "$#" -ge 2 ] || exit 1
  for label in "$@"; do
    [ -n "$label" ] && [ "${#label}" -le 63 ] || exit 1
    case "$label" in
      -*|*-) exit 1 ;;
    esac
  done
)

if ! validate_ipv4 "$lan_ip"; then
  echo "The LAN address must be a canonical IPv4 address with four 0-255 octets." >&2
  usage
  exit 2
fi
if ! validate_dns_name "$stable_dns"; then
  echo "The optional DNS name must be a valid dotted hostname such as macbook-pro.local." >&2
  usage
  exit 2
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
local_dir="$project_dir/.local"
cert_dir="$local_dir/https"
public_ca="$project_dir/public/lumen-local-ca.cer"
serial_file="$cert_dir/ca-cert.srl"
work_dir=
backup_dir=
public_temp=
lock_dir="$local_dir/.https-operation-lock"
lock_held=0
rollback=0
create_rollback=0

cleanup() {
  if [ "$create_rollback" -eq 1 ]; then
    # Create starts only after proving both targets are absent. If a signal
    # lands between the two final renames, remove the newly generated half so
    # the next create is not stranded by an orphaned CA or trust directory.
    rm -rf "$cert_dir"
    rm -f "$public_ca"
  fi
  if [ "$rollback" -eq 1 ] && [ -n "$backup_dir" ] && [ -d "$backup_dir" ]; then
    for name in server-key.pem server-cert.pem server.csr server.ext; do
      # Remove any newly installed file even when the previous leaf was
      # incomplete and therefore had no corresponding backup member.
      rm -f "$cert_dir/$name"
      if [ -f "$backup_dir/$name" ]; then
        mv "$backup_dir/$name" "$cert_dir/$name"
      fi
    done
  fi
  if [ -n "$work_dir" ] && [ -d "$work_dir" ]; then
    rm -rf "$work_dir"
  fi
  if [ -n "$backup_dir" ] && [ -d "$backup_dir" ]; then
    rm -rf "$backup_dir"
  fi
  if [ -n "$public_temp" ] && [ -f "$public_temp" ]; then
    rm -f "$public_temp"
  fi
  if [ "$lock_held" -eq 1 ]; then
    rmdir "$lock_dir" 2>/dev/null || true
  fi
}

handle_signal() {
  # POSIX shells may resume the interrupted command after a signal trap. Make
  # interruption terminal and prevent EXIT from invoking cleanup twice.
  trap - EXIT HUP INT TERM
  cleanup
  exit 1
}

trap cleanup EXIT
trap handle_signal HUP INT TERM

write_leaf_extensions() {
  target=$1
  san="IP:$lan_ip,IP:127.0.0.1,DNS:localhost"
  if [ -n "$stable_dns" ]; then
    san="$san,DNS:$stable_dns"
  fi
  cat > "$target" <<EOF
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=$san
authorityKeyIdentifier=keyid,issuer
subjectKeyIdentifier=hash
EOF
}

generate_leaf() {
  target_dir=$1
  signing_serial=$2

  openssl req -newkey rsa:2048 -nodes -sha256 \
    -keyout "$target_dir/server-key.pem" \
    -out "$target_dir/server.csr" \
    -subj "/CN=Lumen Local Server/O=Lumen Local" \
    >/dev/null 2>&1
  write_leaf_extensions "$target_dir/server.ext"
  openssl x509 -req -sha256 -days 397 \
    -in "$target_dir/server.csr" \
    -CA "$cert_dir/ca-cert.pem" \
    -CAkey "$cert_dir/ca-key.pem" \
    -CAserial "$signing_serial" \
    -out "$target_dir/server-cert.pem" \
    -extfile "$target_dir/server.ext" \
    >/dev/null 2>&1
}

verify_leaf() {
  target_dir=$1
  openssl verify -CAfile "$cert_dir/ca-cert.pem" "$target_dir/server-cert.pem" >/dev/null
  cert_modulus=$(openssl x509 -in "$target_dir/server-cert.pem" -noout -modulus)
  key_modulus=$(openssl rsa -in "$target_dir/server-key.pem" -noout -modulus 2>/dev/null)
  [ "$cert_modulus" = "$key_modulus" ] || {
    echo "The staged server certificate does not match its private key." >&2
    return 1
  }
  certificate_text=$(openssl x509 -in "$target_dir/server-cert.pem" -noout -text)
  case "$certificate_text" in
    *"IP Address:$lan_ip"*) ;;
    *) echo "The staged certificate is missing the requested LAN IP SAN." >&2; return 1 ;;
  esac
  if [ -n "$stable_dns" ]; then
    case "$certificate_text" in
      *"DNS:$stable_dns"*) ;;
      *) echo "The staged certificate is missing the requested stable DNS SAN." >&2; return 1 ;;
    esac
  fi
}

umask 077
mkdir -p "$local_dir" "$project_dir/public"
if ! mkdir "$lock_dir" 2>/dev/null; then
  echo "Another HTTPS create/renew operation appears to be active." >&2
  echo "If no operation is running, remove only this stale lock: $lock_dir" >&2
  exit 1
fi
lock_held=1

if [ "$mode" = create ]; then
  if [ -e "$cert_dir" ] || [ -e "$public_ca" ]; then
    echo "Refusing to replace existing HTTPS trust material." >&2
    echo "Use --renew to replace only the server leaf while preserving the installed CA." >&2
    exit 1
  fi

  work_dir=$(mktemp -d "$local_dir/https.create.XXXXXX")
  openssl req -x509 -newkey rsa:3072 -nodes -sha256 -days 3650 \
    -keyout "$work_dir/ca-key.pem" \
    -out "$work_dir/ca-cert.pem" \
    -subj "/CN=Lumen Local Learning CA/O=Lumen Local" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    >/dev/null 2>&1

  # generate_leaf reads the CA through cert_dir, so temporarily point that path
  # at the fully staged directory. No production file is replaced piecemeal.
  cert_dir=$work_dir
  serial_file="$work_dir/ca-cert.srl"
  # Seed an explicit serial path. This prevents OpenSSL/LibreSSL from leaving a
  # stray .srl in the caller's working directory.
  printf '%s\n' "$(openssl rand -hex 16)" > "$serial_file"
  generate_leaf "$work_dir" "$serial_file"
  verify_leaf "$work_dir"
  chmod 600 "$work_dir/ca-key.pem" "$work_dir/server-key.pem" "$serial_file"
  chmod 644 "$work_dir/ca-cert.pem" "$work_dir/server-cert.pem"

  public_temp=$(mktemp "$project_dir/public/.lumen-local-ca.XXXXXX")
  openssl x509 -in "$work_dir/ca-cert.pem" -outform der -out "$public_temp"
  chmod 644 "$public_temp"

  cert_dir="$local_dir/https"
  create_rollback=1
  mv "$work_dir" "$cert_dir"
  work_dir=
  mv "$public_temp" "$public_ca"
  public_temp=
  create_rollback=0

  echo "Created a private Lumen CA and server certificate for $lan_ip${stable_dns:+ and $stable_dns}."
else
  for required in ca-key.pem ca-cert.pem; do
    if [ ! -f "$cert_dir/$required" ]; then
      echo "Cannot renew: $cert_dir/$required is missing." >&2
      echo "Restore the CA private key from offline storage before renewal." >&2
      exit 1
    fi
  done
  # Offline restores can inherit permissive transfer-media modes. Tighten the
  # signing key before OpenSSL reads it.
  chmod 600 "$cert_dir/ca-key.pem"

  ca_cert_modulus=$(openssl x509 -in "$cert_dir/ca-cert.pem" -noout -modulus)
  ca_key_modulus=$(openssl rsa -in "$cert_dir/ca-key.pem" -noout -modulus 2>/dev/null)
  if [ "$ca_cert_modulus" != "$ca_key_modulus" ]; then
    echo "Cannot renew: the CA certificate and private key do not match." >&2
    exit 1
  fi
  if ! openssl x509 -in "$cert_dir/ca-cert.pem" -noout -checkend 34300800 >/dev/null; then
    echo "Cannot issue a 397-day leaf: the existing CA expires too soon." >&2
    exit 1
  fi

  public_temp=$(mktemp "$project_dir/public/.lumen-local-ca.XXXXXX")
  openssl x509 -in "$cert_dir/ca-cert.pem" -outform der -out "$public_temp"
  chmod 644 "$public_temp"

  if [ ! -s "$serial_file" ]; then
    # Older script versions could create a stray project-root .srl. Recover the
    # next value from a valid current leaf. If that leaf is also unavailable,
    # seed a fresh 128-bit serial sequence so leaf recovery remains possible.
    if [ -f "$cert_dir/server-cert.pem" ] && \
       openssl x509 -in "$cert_dir/server-cert.pem" -noout >/dev/null 2>&1; then
      openssl x509 -in "$cert_dir/server-cert.pem" -noout -next_serial > "$serial_file"
    else
      printf '%s\n' "$(openssl rand -hex 16)" > "$serial_file"
    fi
    chmod 600 "$serial_file"
  fi

  work_dir=$(mktemp -d "$cert_dir/.renew.XXXXXX")
  generate_leaf "$work_dir" "$serial_file"
  verify_leaf "$work_dir"
  chmod 600 "$work_dir/server-key.pem"
  chmod 644 "$work_dir/server-cert.pem"

  backup_dir=$(mktemp -d "$cert_dir/.renew-backup.XXXXXX")
  for name in server-key.pem server-cert.pem server.csr server.ext; do
    if [ -f "$cert_dir/$name" ]; then
      # Copy first, leaving the active leaf untouched until the complete
      # rollback set exists. A failure/signal during this loop is harmless.
      cp -p "$cert_dir/$name" "$backup_dir/$name"
    fi
  done
  rollback=1
  for name in server-key.pem server-cert.pem server.csr server.ext; do
    mv "$work_dir/$name" "$cert_dir/$name"
  done
  verify_leaf "$cert_dir"
  rollback=0
  rm -rf "$backup_dir"
  backup_dir=
  rm -rf "$work_dir"
  work_dir=
  mv "$public_temp" "$public_ca"
  public_temp=

  echo "Renewed only the server certificate for $lan_ip${stable_dns:+ and $stable_dns}; the trusted CA is unchanged."
fi

echo "TLS_CERT_FILE=$cert_dir/server-cert.pem"
echo "TLS_KEY_FILE=$cert_dir/server-key.pem"
echo "Public iPhone certificate: $public_ca"
openssl x509 -in "$cert_dir/ca-cert.pem" -noout -sha256 -fingerprint
echo "Keep server-key.pem on the server. Store ca-key.pem offline between renewals."
