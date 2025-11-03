# Event Manager Favicon

## Overview

The Event Manager uses a custom favicon featuring **interlocking gears** design to represent event coordination, workflow, and management functionality. The design uses a blue color scheme that matches common event management interfaces.

## Design Elements

- **Interlocking Gears**: Represents coordination, workflow, and the interconnected nature of event management
- **Two Gears**: Symbolizes collaboration and synchronization
- **Colors**: Blue theme (#3b82f6, #1e40af, #e0e7ff) for a professional, trustworthy appearance

## Files Created

### SVG Source
- `public/favicon.svg` - Vector source file (32x32 viewport) with interlocking gears

### PNG Versions (to be generated)
- `public/favicon-16x16.png` - Standard favicon size
- `public/favicon-32x32.png` - High-DPI favicon
- `public/apple-touch-icon.png` - Apple touch icon (180x180)
- `public/android-chrome-192x192.png` - Android icon
- `public/android-chrome-512x512.png` - High-res Android icon

### Configuration
- `public/site.webmanifest` - Web app manifest configuration
- `generate-favicons.js` - Script to generate PNG files from SVG
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
   cd apps/event-manager
   node generate-favicons.js
   ```

3. **Generate favicon.ico**:
   - Visit [favicon.io converter](https://favicon.io/favicon-converter/)
   - Upload `public/favicon-32x32.png`
   - Download the generated `favicon.ico`
   - Place it in the `public/` directory

### Option 2: Using RealFaviconGenerator (Easiest)

1. **Visit** [RealFaviconGenerator.net](https://realfavicongenerator.net/)
2. **Upload** `public/favicon.svg`
3. **Configure** settings for each platform
4. **Download** the complete package
5. **Replace** files in the `public/` directory

### Option 3: Manual Generation

1. **Open the preview page**:
   ```bash
   cd apps/event-manager
   open favicon-preview.html
   ```

2. **Take screenshots** at the required sizes:
   - 16x16 pixels → save as `favicon-16x16.png`
   - 32x32 pixels → save as `favicon-32x32.png`
   - 180x180 pixels → save as `apple-touch-icon.png`
   - 192x192 pixels → save as `android-chrome-192x192.png`
   - 512x512 pixels → save as `android-chrome-512x512.png`

3. **Place files** in the `public/` directory

## Web Manifest Configuration

Update `public/site.webmanifest` with appropriate app information:

```json
{
  "name": "Event Manager",
  "short_name": "Events",
  "icons": [
    {
      "src": "/android-chrome-192x192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/android-chrome-512x512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ],
  "theme_color": "#3b82f6",
  "background_color": "#ffffff",
  "display": "standalone"
}
```

## Testing

After installation:

1. **Restart the development server**:
   ```bash
   npm run dev
   # or from monorepo root
   pnpm --filter event-manager dev
   ```

2. **Check the favicon** in:
   - Browser tabs
   - Bookmarks
   - Mobile home screen (if added as PWA)
   - Different browsers (Chrome, Firefox, Safari, Edge)

3. **Verify all sizes** are working correctly

4. **Test on dark mode** to ensure visibility

## Browser Support

The favicon setup supports:
- **Modern browsers**: SVG favicon with PNG fallbacks
- **Legacy browsers**: ICO and PNG favicon fallbacks
- **iOS**: Apple touch icon for home screen
- **Android**: Various sizes for home screen and splash

## Troubleshooting

### Favicon not appearing
- Clear browser cache (Cmd+Shift+R / Ctrl+Shift+R)
- Check file paths in HTML head
- Verify PNG files exist in the `public/` directory
- Hard refresh the page

### Wrong colors or appearance
- Ensure PNG files were generated from the correct SVG
- Check that the SVG file is not corrupted
- Verify the color values in the SVG file

### Missing sizes
- Regenerate PNG files using the script or manual process
- Check that all required file names are present in `public/`

### Blurry or pixelated icons
- Use higher resolution source
- Ensure ImageMagick uses proper scaling algorithm
- Consider regenerating with online tools

## Customization

To modify the favicon:

1. **Edit the SVG** in `public/favicon.svg`
2. **Regenerate PNG files** using the script
3. **Test** in different browsers and platforms

### Color Changes
Update the fill colors in the SVG:
- Primary blue: `#3b82f6`
- Secondary blue: `#1e40af`
- Accent light blue: `#e0e7ff`

### Design Changes
Modify the SVG paths to change the gear design while maintaining:
- 32x32 viewport size
- Clear visibility at small sizes (16x16)
- Good contrast on both light and dark backgrounds

## File Structure

```
apps/event-manager/
├── public/
│   ├── favicon.svg              # Source SVG file (interlocking gears)
│   ├── favicon-16x16.png        # Standard favicon
│   ├── favicon-32x32.png        # High-DPI favicon
│   ├── apple-touch-icon.png     # Apple touch icon
│   ├── android-chrome-192x192.png  # Android icon
│   ├── android-chrome-512x512.png  # High-res Android
│   ├── favicon.ico              # Legacy ICO file
│   └── site.webmanifest         # Web app manifest
├── generate-favicons.js         # Generation script
├── favicon-preview.html         # Preview page
└── FAVICON.md                   # This documentation
```

## Design Philosophy

The interlocking gears design was chosen to represent:
- **Coordination**: Multiple moving parts working together
- **Efficiency**: Smooth event workflow and management
- **Professionalism**: Clean, modern appearance
- **Reliability**: Gears represent precision and dependability

The blue color palette conveys:
- **Trust**: Primary color for professional applications
- **Clarity**: Easy to see in tabs and bookmarks
- **Calm**: Appropriate for management/organizational tools

