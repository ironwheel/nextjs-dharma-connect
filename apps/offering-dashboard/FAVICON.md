# Admin Dashboard Favicon

## Overview

The admin dashboard uses a custom favicon featuring a shield and gear design to represent admin/management functionality. The design uses a blue color scheme that matches the dashboard interface.

## Design Elements

- **Shield**: Represents security, protection, and administrative authority
- **Gear**: Represents management, configuration, and system administration
- **Colors**: Blue theme (#2563eb, #1d4ed8, #dbeafe) matching the dashboard interface

## Files Created

### SVG Source
- `public/favicon.svg` - Vector source file (32x32 viewport)

### PNG Versions (to be generated)
- `public/favicon-16x16.png` - Standard favicon size
- `public/favicon-32x32.png` - High-DPI favicon
- `public/apple-touch-icon.png` - Apple touch icon (180x180)

### Configuration
- `pages/_document.tsx` - Next.js document with favicon links
- `generate-favicons.js` - Script to generate PNG files
- `favicon-preview.html` - Preview page for manual generation

## Installation Steps

### Option 1: Automated Generation (Recommended)

1. **Install ImageMagick** (if not already installed):
   ```bash
   # macOS
   brew install imagemagick
   
   # Ubuntu/Debian
   sudo apt-get install imagemagick
   
   # Windows
   # Download from https://imagemagick.org/script/download.php
   ```

2. **Generate PNG files**:
   ```bash
   cd apps/event-dashboard
   node generate-favicons.js
   ```

### Option 2: Manual Generation

1. **Open the preview page**:
   ```bash
   cd apps/event-dashboard
   open favicon-preview.html
   ```

2. **Take screenshots** at the required sizes:
   - 16x16 pixels → save as `favicon-16x16.png`
   - 32x32 pixels → save as `favicon-32x32.png`
   - 180x180 pixels → save as `apple-touch-icon.png`

3. **Place files** in the `public/` directory

### Option 3: Online Converter

1. **Upload the SVG** to an online converter:
   - [Convertio](https://convertio.co/svg-png/)
   - [Favicon.io](https://favicon.io/favicon-converter/)

2. **Download and rename** the generated files to match the required names

3. **Place files** in the `public/` directory

## Testing

After installation:

1. **Restart the development server**:
   ```bash
   npm run dev
   ```

2. **Check the favicon** in:
   - Browser tabs
   - Bookmarks
   - Mobile home screen (if added)
   - Different browsers (Chrome, Firefox, Safari, Edge)

3. **Verify all sizes** are working correctly

## Browser Support

The favicon setup supports:
- **Modern browsers**: SVG favicon with PNG fallbacks
- **Legacy browsers**: PNG favicon fallbacks
- **iOS**: Apple touch icon for home screen
- **Android**: Standard favicon support

## Troubleshooting

### Favicon not appearing
- Clear browser cache
- Check file paths in `_document.tsx`
- Verify PNG files are in the `public/` directory

### Wrong colors or appearance
- Ensure PNG files were generated from the correct SVG
- Check that the SVG file is not corrupted
- Verify the color values in the SVG file

### Missing sizes
- Regenerate PNG files using the script or manual process
- Check that all required file names are present

## Customization

To modify the favicon:

1. **Edit the SVG** in `public/favicon.svg`
2. **Regenerate PNG files** using the script
3. **Test** in different browsers

### Color Changes
Update the fill colors in the SVG:
- Primary blue: `#2563eb`
- Secondary blue: `#1d4ed8`
- Accent blue: `#dbeafe`

### Design Changes
Modify the SVG paths to change the shield or gear design while maintaining the 32x32 viewport.

## File Structure

```
apps/event-dashboard/
├── public/
│   ├── favicon.svg          # Source SVG file
│   ├── favicon-16x16.png    # Standard favicon
│   ├── favicon-32x32.png    # High-DPI favicon
│   ├── apple-touch-icon.png # Apple touch icon
│   └── favicon.ico          # Legacy ICO file
├── pages/
│   └── _document.tsx        # Favicon configuration
├── generate-favicons.js     # Generation script
├── favicon-preview.html     # Preview page
└── FAVICON.md              # This documentation
``` 