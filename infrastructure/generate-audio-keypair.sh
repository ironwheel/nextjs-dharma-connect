#!/usr/bin/env bash
#
# Generates the RSA key pair that signs teaching-audio playback URLs.
#
#   - audio-signing-public.pem  is read at synth time by AudioStack and uploaded to
#     CloudFront as a trusted public key. Safe to keep locally; not secret.
#   - audio-signing-private.pem is the signing key. It belongs ONLY in the API's
#     CLOUDFRONT_AUDIO_PRIVATE_KEY environment variable (base64, matching the existing
#     API_RSA_PRIVATE convention). Anyone holding it can mint playback URLs for any
#     object in the bucket.
#
# Both files match *.pem in the repo root .gitignore. Do not commit either one.

set -euo pipefail

cd "$(dirname "$0")"

PRIVATE_PEM="audio-signing-private.pem"
PUBLIC_PEM="audio-signing-public.pem"

if [ -f "$PRIVATE_PEM" ] || [ -f "$PUBLIC_PEM" ]; then
    echo "ERROR: a key pair already exists here:" >&2
    [ -f "$PRIVATE_PEM" ] && echo "  $(pwd)/$PRIVATE_PEM" >&2
    [ -f "$PUBLIC_PEM" ] && echo "  $(pwd)/$PUBLIC_PEM" >&2
    echo >&2
    echo "Replacing the key pair invalidates every URL the API has already minted and" >&2
    echo "requires updating the CloudFront key group and the API environment together." >&2
    echo "Move the existing files aside deliberately if that is what you intend." >&2
    exit 1
fi

# CloudFront requires RSA-2048 in SSH-RSA/PEM (SubjectPublicKeyInfo) form.
openssl genrsa -out "$PRIVATE_PEM" 2048
openssl rsa -pubout -in "$PRIVATE_PEM" -out "$PUBLIC_PEM"
chmod 600 "$PRIVATE_PEM"

echo
echo "Wrote $(pwd)/$PUBLIC_PEM  (read by AudioStack at synth time)"
echo "Wrote $(pwd)/$PRIVATE_PEM (chmod 600 — never commit, never leaves your machine)"
echo
echo "Set this as CLOUDFRONT_AUDIO_PRIVATE_KEY in the API environment:"
echo
base64 < "$PRIVATE_PEM" | tr -d '\n'
echo
echo
echo "Then deploy the stack; its AudioSigningKeyPairId output is CLOUDFRONT_AUDIO_KEY_PAIR_ID."
