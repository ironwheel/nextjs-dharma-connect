import os
import sys

def export_env_variables(env_file_path=".env"):
    """
    Reads a .env file and prints 'export KEY=VALUE' commands to stdout.
    These commands can then be evaluated by a shell to set environment variables.

    Args:
        env_file_path (str): The path to the .env file.
    """
    if not os.path.exists(env_file_path):
        print(f"Error: .env file not found at '{env_file_path}'", file=sys.stderr)
        sys.exit(1)

    try:
        with open(env_file_path, 'r') as f:
            for line in f:
                line = line.strip()
                # Skip empty lines and comments
                if not line or line.startswith('#'):
                    continue

                # Split line into key and value
                # Handle cases where value might contain '='
                if '=' in line:
                    key, value = line.split('=', 1)
                    key = key.strip()
                    value = value.strip()

                    # Ensure value is properly quoted for shell export
                    # This handles spaces and special characters in values
                    # If the value already contains single quotes, it might need more complex handling
                    # For simplicity, we'll wrap in double quotes and escape existing double quotes
                    value = value.replace('"', '\\"') # Escape existing double quotes
                    print(f'export {key}="{value}"')
                else:
                    # Line might be a malformed key without a value, or just a key
                    # We can choose to ignore or warn. For now, ignore.
                    pass
    except Exception as e:
        print(f"Error reading .env file: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    # You can pass the .env file path as a command-line argument,
    # otherwise, it defaults to '.env' in the current directory.
    if len(sys.argv) > 1:
        env_path = sys.argv[1]
    else:
        env_path = ".env"
    export_env_variables(env_path)

