# Image Date Editor

A common issue adding film camera picture scans to iCloud is that the image date is the scan date and the images won't show up correctly in the library or won't be added to iCloud automatic trip categorizations. There are tools that can help you, but they're annoying to use. They either don't work (Shotwell, wrong exif fields) or require too many mouse operations (windows exif editors) or touches (iOS Photos app). 

Here I created the fastest tool for this purpose (that i could find) because you can update image dates using natural language input ("last tuesday", "3 months ago", "july") and "tab" press through the whole folder. This tool helped me with hundreds of film scans, although it's entirely vibe coded with Cursor so use at your own risk.

## Usage

1. **Create a virtual environment and install dependencies**:
   ```bash
   uv venv
   source .venv/bin/activate  # On Windows: .venv\Scripts\activate
   uv pip install Pillow dateparser
   ```

2. **Run the application**:
   ```bash
   source .venv/bin/activate  # On Windows: .venv\Scripts\activate
   uv run image_date_editor.py
   ```

2. **Select a folder**: When the application starts, a folder dialog will appear. Select the folder containing your images (defaults to your `~/Pictures` directory).

3. **Navigate and edit dates**:
   - Use the **Previous** and **Next** buttons or keyboard shortcuts to navigate between images
   - Enter a date in the text field using natural language
   - Click **Set Date** or press Enter/Space to update the date
   - The date will be written to the image's EXIF metadata

## Keyboard Shortcuts

- **Tab**: Navigate to next image
- **Shift+Tab**: Navigate to previous image
- **Enter** / **Space**: Set the date for the current image

## Date Input Examples

The tool accepts various natural language date formats:

- **Simple dates**: `Nov 24`, `December 25 2023`, `2023-12-25`
- **Relative dates**: `yesterday`, `today`, `tomorrow`
- **Relative time**: `2 months ago`, `3 weeks ago`, `1 year ago`
- **Special dates**: `Christmas 2023`, `New Year's Eve`
- **Any format that `dateparser` understands**

## Supported Image Formats

- JPEG/JPG
- PNG
- TIFF/TIF (including 16-bit grayscale)
- BMP
- GIF

## Technical Details

The tool updates the following EXIF date tags:
- `DateTimeOriginal`
- `DateTime`
- `DateTimeDigitized`

The application handles various image formats and color modes, automatically converting them for display while preserving the original image data (B&W tiff images were tricky).

## License

This tool is provided as-is for personal use.
