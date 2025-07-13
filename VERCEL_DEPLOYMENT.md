# Vercel Deployment Guide for Email-Manager

## Overview

The email-manager app is part of a monorepo and uses shared packages. This guide explains how to configure Vercel for proper deployment.

## Monorepo Structure

```
nextjs-dharma-connect/
├── apps/
│   └── email-manager/          # The app to deploy
├── packages/
│   ├── api/                    # Shared backend API
│   ├── sharedFrontend/         # Shared frontend utilities
│   └── backend-core/           # Shared backend core
└── vercel.json                 # Vercel configuration
```

## Vercel Configuration

### 1. Project Settings in Vercel Dashboard

Set these values in your Vercel project settings:

- **Framework Preset**: Next.js
- **Root Directory**: `apps/email-manager`
- **Build Command**: `cd ../.. && pnpm --filter=email-manager build`
- **Output Directory**: `apps/email-manager/.next`
- **Install Command**: `pnpm install`

### 2. Environment Variables

Add these environment variables in your Vercel project:

#### Required Environment Variables:
- `NEXT_PUBLIC_API_URL` - The base URL of your API (e.g., `https://your-api-domain.com`)

#### Optional Environment Variables:
- `EMAIL_CONTINUOUS_SLEEP_SECS` - Default: `600` (for email sending intervals)

### 3. Package Manager

Ensure Vercel uses pnpm:
- Set **Package Manager** to `pnpm` in project settings
- The `.npmrc` file in the root will configure pnpm behavior

## Shared Dependencies

The email-manager app depends on:
- `sharedFrontend` - Provides API client functions and authentication components
- No direct dependency on `packages/api` (uses sharedFrontend as intermediary)

## Build Process

1. **Installation**: Vercel runs `pnpm install` in the root directory
2. **Build**: Vercel runs `pnpm --filter=email-manager build` which:
   - Builds the sharedFrontend package
   - Builds the email-manager app
   - Outputs to `apps/email-manager/.next`

## Configuration Files

### vercel.json
```json
{
  "buildCommand": "pnpm --filter=email-manager build",
  "outputDirectory": "apps/email-manager/.next",
  "installCommand": "pnpm install",
  "framework": "nextjs"
}
```

### .npmrc
```
auto-install-peers=true
strict-peer-dependencies=false
shamefully-hoist=true
```

## Deployment Checklist

- [ ] Set up Vercel project with correct root directory
- [ ] Configure build command to use pnpm filter
- [ ] Set environment variables (especially `NEXT_PUBLIC_API_URL`)
- [ ] Ensure pnpm is selected as package manager
- [ ] Deploy and verify build success

## Troubleshooting

### Common Issues:

1. **Build fails with workspace errors**: Ensure pnpm is configured and `.npmrc` is present
2. **Missing environment variables**: Check that `NEXT_PUBLIC_API_URL` is set
3. **Shared package not found**: Verify workspace configuration in `pnpm-workspace.yaml`

### Debug Commands:

```bash
# Test build locally
pnpm --filter=email-manager build

# Check workspace dependencies
pnpm list --depth=0

# Verify environment variables
echo $NEXT_PUBLIC_API_URL
``` 