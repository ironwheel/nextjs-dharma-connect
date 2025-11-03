# Calculate Hash Utility

## Overview

`calculate-hash.js` is a Node.js script that generates HMAC-SHA256 hashes for secure user access. It creates authenticated URLs by combining a user's UUID with a secret key to produce a cryptographic hash.

## Purpose

This utility is used to:
- Generate secure access URLs for users without traditional authentication
- Create HMAC-SHA256 hashes using a UUID and a secret key
- Provide URL-based authentication for dashboards and applications

## Usage

### Basic Usage (Interactive Mode)

If you only provide the UUID, the script will prompt you to enter the secret interactively:

```bash
node utils/calculate-hash.js <UUID>
```

**Example:**
```bash
node utils/calculate-hash.js 550e8400-e29b-41d4-a716-446655440000
```

The script will then prompt you to paste your 64-character hex secret.

### Command-Line Mode

You can provide both the UUID and secret as arguments:

```bash
node utils/calculate-hash.js <UUID> <SECRET>
```

**Example:**
```bash
node utils/calculate-hash.js 550e8400-e29b-41d4-a716-446655440000 a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890
```

## Parameters

1. **UUID (required)**: The unique identifier for the user (e.g., user ID, participant ID)
   - Must be provided as the first argument
   - Example: `550e8400-e29b-41d4-a716-446655440000`

2. **Secret (optional)**: A 64-character hexadecimal string used as the HMAC key
   - If not provided, you'll be prompted to enter it interactively
   - Must be exactly 64 hexadecimal characters (0-9, a-f)
   - Example: `a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890`

## Output

The script outputs:
- The UUID (pid)
- The calculated HMAC-SHA256 hash
- Ready-to-use access URLs for both localhost and production environments

**Example Output:**
```
✅ Hash calculated successfully!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 User Access Details:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

UUID (pid):  550e8400-e29b-41d4-a716-446655440000
Hash:        [calculated-hash-value]

🔗 Access URL (localhost):
   http://localhost:3000/?pid=550e8400-e29b-41d4-a716-446655440000&hash=[hash]

🔗 Access URL (production - update domain):
   https://alerts-dashboard.yourdomain.com/?pid=550e8400-e29b-41d4-a716-446655440000&hash=[hash]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💡 Save this URL for the user to access the dashboard
⚠️  Keep the hash secret - it grants access to the user's account
```

## Security Considerations

- **Keep secrets secure**: The secret key must be kept confidential
- **Keep hashes private**: The generated hash grants access to the user's account
- **Secret format**: The secret must be a 64-character hexadecimal string
- **HMAC-SHA256**: Uses industry-standard cryptographic hashing

## How It Works

1. Takes a UUID (user identifier) and a secret key as input
2. Validates the secret format (64-character hex string)
3. Converts the hex secret to a binary buffer
4. Creates an HMAC-SHA256 hash using the secret as the key
5. Updates the hash with the UUID
6. Generates the final hash digest in hexadecimal format
7. Outputs formatted URLs ready for sharing with users

## Error Handling

The script validates:
- UUID presence (required)
- Secret format (must be 64-character hex string)

Common errors:
- Missing UUID: "❌ Error: UUID is required"
- Invalid secret format: "❌ Error: Secret must be a 64-character hexadecimal string"

## Use Cases

- **Passwordless authentication**: Generate access links for users without requiring passwords
- **Dashboard access**: Create secure URLs for accessing analytics or admin dashboards
- **API authentication**: Generate HMAC signatures for API requests
- **User invitation links**: Create secure, time-limited access URLs

## Making the Script Executable

To run the script directly without typing `node`:

```bash
chmod +x utils/calculate-hash.js
./utils/calculate-hash.js <UUID>
```

