#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from PIL import Image, ExifTags, ImageTk, ImageOps, ImageMath
import os
from datetime import datetime
import tkinter as tk
from tkinter import filedialog, messagebox
from tkinter import Label, Button, Frame, Entry
import dateparser


class ImageDateEditor:
    def __init__(self, root, folder_path):
        self.root = root
        self.folder_path = folder_path
        self.files = [f for f in os.listdir(folder_path)
                      if f.lower().endswith(('.jpg', '.jpeg', '.png', '.tif', '.tiff', '.bmp', '.gif'))]
        self.idx = 0
        self.current_image = None
        self.date_var = tk.StringVar(value="")  # persists last entered prompt

        if not self.files:
            messagebox.showerror("Error", "No image files found in the specified folder.")
            return

        # Window
        self.root.title("Image Date Editor - Large Preview")
        self.root.geometry("1900x1400")
        self.root.configure(bg='#f0f0f0')

        # Clear existing widgets
        for widget in self.root.winfo_children():
            widget.destroy()

        main_frame = Frame(self.root, bg='#f0f0f0')
        main_frame.pack(fill=tk.BOTH, expand=True, padx=15, pady=15)

        # Image preview
        image_frame = Frame(main_frame, bg='white', relief=tk.SUNKEN, bd=2)
        image_frame.pack(pady=10, padx=10, fill=tk.BOTH, expand=True)

        self.label_image = Label(image_frame, bg='white', text="Loading image...")
        self.label_image.pack(padx=10, pady=10, fill=tk.BOTH, expand=True)

        # Status line
        self.label_status = Label(main_frame, text="", wraplength=1800,
                                  bg='#f0f0f0', font=('Arial', 12))
        self.label_status.pack(pady=6)

        # Date input row (embedded prompt)
        prompt_frame = Frame(main_frame, bg='#f0f0f0')
        prompt_frame.pack(pady=6)

        Label(prompt_frame, text="Date input:", font=('Arial', 12), bg='#f0f0f0').pack(side=tk.LEFT, padx=(0, 8))
        self.entry_date = Entry(prompt_frame, textvariable=self.date_var, width=60, font=('Arial', 12))
        self.entry_date.pack(side=tk.LEFT, padx=6)
        self.entry_date.bind('<Return>', lambda e: self.set_date())

        self.btn_date = Button(prompt_frame, text="📅 Set Date", command=self.set_date,
                               width=15, font=('Arial', 12), height=1, bg='#4CAF50', fg='white')
        self.btn_date.pack(side=tk.LEFT, padx=8)

        # Example hint
        Label(main_frame,
              text="Examples:  Nov 24   •   yesterday   •   2 months ago   •   Christmas 2023",
              bg='#f0f0f0', font=('Arial', 10), fg='#555').pack(pady=(0, 10))

        # Nav buttons
        button_frame = Frame(main_frame, bg='#f0f0f0')
        button_frame.pack(pady=10)

        self.btn_prev = Button(button_frame, text="◀ Previous", command=self.prev_image,
                               width=18, font=('Arial', 14), height=2)
        self.btn_prev.pack(side=tk.LEFT, padx=8)

        self.btn_next = Button(button_frame, text="Next ▶", command=self.next_image,
                               width=18, font=('Arial', 14), height=2)
        self.btn_next.pack(side=tk.LEFT, padx=8)

        self.show_image()

    # -------- TIFF helpers --------

    def _tiff_get(self, im, code):
        """Get TIFF tag by numeric code (works for tag_v2 or tag)."""
        for attr in ("tag_v2", "tag"):
            tags = getattr(im, attr, None)
            if tags:
                try:
                    v = tags.get(code)
                    if isinstance(v, (list, tuple)):
                        return v[0]
                    return v
                except Exception:
                    pass
        return None

    def _get_tiff_photometric(self, im):
        # 262 = PhotometricInterpretation
        return self._tiff_get(im, 262)

    def _get_tiff_smin_smax(self, im):
        # 280/281 = SMinSampleValue/SMaxSampleValue (optional)
        smin = self._tiff_get(im, 280)
        smax = self._tiff_get(im, 281)
        try:
            smin = float(smin) if smin is not None else None
            smax = float(smax) if smax is not None else None
        except Exception:
            smin, smax = None, None
        return smin, smax

    def _invert_if_white_is_zero(self, img, photometric):
        """Invert only if PhotometricInterpretation == WhiteIsZero (0) and mode supports invert."""
        try:
            if photometric == 0 and img.mode in ('L', 'RGB'):
                return ImageOps.invert(img)
        except Exception:
            pass
        return img

    def _rescale_I_or_F_to_L(self, im_if, smin=None, smax=None):
        """Linearly rescale 32-bit int/float to 0..255 with ImageMath; return 'L'."""
        try:
            f = im_if.convert('F')
            if smin is None or smax is None or smax <= smin:
                mn, mx = f.getextrema()
            else:
                mn, mx = float(smin), float(smax)

            if mn is None or mx is None or mx == mn:
                return f.convert('L')

            scale = 255.0 / float(mx - mn)
            f2 = ImageMath.eval("((im - mn) * sc)", im=f, mn=float(mn), sc=scale)
            return f2.convert('L')
        except Exception:
            try:
                return im_if.convert('L')
            except Exception:
                return im_if.convert('RGB').convert('L')

    def _flatten_alpha_to_rgb(self, pil_img):
        """Flatten alpha onto white and return RGB."""
        if pil_img.mode == 'RGBA':
            bg = Image.new('RGB', pil_img.size, (255, 255, 255))
            bg.paste(pil_img, mask=pil_img.split()[-1])
            return bg
        if pil_img.mode == 'LA':
            bg = Image.new('RGBA', pil_img.size, (255, 255, 255, 255))
            merged = Image.alpha_composite(bg, pil_img.convert('RGBA'))
            return merged.convert('RGB')
        return pil_img.convert('RGB')

    def _to_displayable_rgb(self, pil_img):
        """
        Normalize any image to RGB for Tk display:
        - Apply EXIF orientation
        - Normalize grayscale (I;16 / I / F) via linear rescale
        - Handle WhiteIsZero (invert after L/RGB)
        - Flatten alpha
        """
        # EXIF orientation
        try:
            pil_img = ImageOps.exif_transpose(pil_img)
        except Exception:
            pass

        # Capture TIFF metadata before mode changes
        photometric = self._get_tiff_photometric(pil_img)
        smin, smax = self._get_tiff_smin_smax(pil_img)
        mode = pil_img.mode

        # Palette → RGB early
        if mode == 'P':
            rgb = pil_img.convert('RGB')
            rgb = self._invert_if_white_is_zero(rgb, photometric)
            return rgb

        # Alpha modes
        if mode in ('RGBA', 'LA'):
            rgb = self._flatten_alpha_to_rgb(pil_img)
            rgb = self._invert_if_white_is_zero(rgb, photometric)
            return rgb

        # Color spaces → RGB
        if mode in ('CMYK', 'YCbCr'):
            rgb = pil_img.convert('RGB')
            rgb = self._invert_if_white_is_zero(rgb, photometric)
            return rgb

        # 16-bit grayscale variants → convert to 'I' and rescale
        if mode in ('I;16', 'I;16B', 'I;16L'):
            l8 = self._rescale_I_or_F_to_L(pil_img.convert('I'), smin, smax)
            l8 = self._invert_if_white_is_zero(l8, photometric)
            return l8.convert('RGB')

        # 32-bit int / float grayscale
        if mode in ('I', 'F'):
            l8 = self._rescale_I_or_F_to_L(pil_img, smin, smax)
            l8 = self._invert_if_white_is_zero(l8, photometric)
            return l8.convert('RGB')

        # 1-bit bilevel
        if mode == '1':
            l8 = pil_img.convert('L')
            l8 = self._invert_if_white_is_zero(l8, photometric)
            return l8.convert('RGB')

        # 8-bit grayscale
        if mode == 'L':
            l8 = self._invert_if_white_is_zero(pil_img, photometric)
            return l8.convert('RGB')

        # Anything else → force RGB, then maybe invert
        try:
            rgb = pil_img.convert('RGB')
        except Exception:
            rgb = Image.new('RGB', pil_img.size, (255, 255, 255))
        rgb = self._invert_if_white_is_zero(rgb, photometric)
        return rgb

    # -------- UI actions --------

    def show_image(self):
        if not self.files:
            return

        img_path = os.path.join(self.folder_path, self.files[self.idx])

        try:
            pil_img = Image.open(img_path)
            orig_size = pil_img.size
            orig_mode = pil_img.mode

            # Normalize to displayable RGB (handles grayscale TIFF issues)
            pil_img = self._to_displayable_rgb(pil_img)

            # Safety: ensure final mode is RGB no matter what
            if pil_img.mode != 'RGB':
                try:
                    pil_img = pil_img.convert('RGB')
                except Exception:
                    pil_img = Image.new('RGB', pil_img.size, (255, 255, 255))

            # Large preview size
            pil_img.thumbnail((1800, 1300), Image.Resampling.LANCZOS)

            img_tk = ImageTk.PhotoImage(pil_img)

            self.current_image = img_tk
            self.label_image.configure(image=img_tk, text="")
            self.label_image.image = img_tk

            file_size = os.path.getsize(img_path) / 1024
            display_size = pil_img.size
            self.label_status.configure(
                text=f"📁 {self.files[self.idx]} ({self.idx + 1}/{len(self.files)}) | "
                     f"📐 Original: {orig_size[0]}×{orig_size[1]} | Display: {display_size[0]}×{display_size[1]} | "
                     f"🎨 {orig_mode} mode | 💾 {file_size:.1f} KB"
            )

            self.btn_prev.configure(state=tk.NORMAL if self.idx > 0 else tk.DISABLED)
            self.btn_next.configure(state=tk.NORMAL if self.idx < len(self.files) - 1 else tk.DISABLED)

        except Exception as e:
            self.label_status.configure(text=f"❌ Error loading {self.files[self.idx]}: {str(e)}")
            self.label_image.configure(image='', text="❌ Could not load image")
            self.current_image = None

    def prev_image(self):
        if self.idx > 0:
            self.idx -= 1
            self.show_image()

    def next_image(self):
        if self.idx < len(self.files) - 1:
            self.idx += 1
            self.show_image()

    def set_date(self):
        user_input = self.date_var.get().strip()

        if not user_input:
            messagebox.showerror("Parse Error", "Please enter a date (e.g., 'Nov 24', 'yesterday', '2 months ago').")
            self.entry_date.focus_set()
            return

        try:
            parsed_date = dateparser.parse(user_input, settings={
                'PREFER_DATES_FROM': 'past',
                'RETURN_AS_TIMEZONE_AWARE': False
            })

            if not parsed_date:
                messagebox.showerror("Parse Error", f"Could not understand '{user_input}'")
                self.entry_date.focus_set()
                return

            img_path = os.path.join(self.folder_path, self.files[self.idx])
            success, msg = update_image_date(img_path, parsed_date)

            if success:
                # Keep the last prompt in the field (per your request)
                self.label_status.configure(text=f"✅ {self.files[self.idx]} - '{user_input}' → {msg}")
                # focus back to entry for quick iteration
                self.entry_date.focus_set()
                self.entry_date.icursor(tk.END)
            else:
                messagebox.showerror("Update Error", msg)
                self.entry_date.focus_set()

        except Exception as e:
            messagebox.showerror("Error", f"Error processing date: {str(e)}")
            self.entry_date.focus_set()


def update_image_date(image_path, date):
    """Update EXIF date tags in image (JPEG/TIFF supported for writing)."""
    try:
        img = Image.open(image_path)
        exif_dict = img.getexif()
        date_str_formatted = date.strftime("%Y:%m:%d 12:00:00")

        for tag, name in ExifTags.TAGS.items():
            if name in ['DateTimeOriginal', 'DateTime', 'DateTimeDigitized']:
                exif_dict[tag] = date_str_formatted

        # Save with EXIF where supported; fallback otherwise
        try:
            img.save(image_path, exif=exif_dict.tobytes())
        except Exception:
            img.save(image_path)

        return True, f"Date updated to {date_str_formatted}"

    except Exception as e:
        return False, f"Error updating image: {str(e)}"


def default_pictures_dir():
    """Return ~/Pictures if it exists; else ~ (home) as a fallback."""
    home = os.path.expanduser("~")
    pictures = os.path.join(home, "Pictures")
    return pictures if os.path.isdir(pictures) else home


def main():
    root = tk.Tk()
    root.withdraw()

    # Default to Pictures folder in home (fallback to home)
    initial = default_pictures_dir()
    folder_path = filedialog.askdirectory(title="Select folder containing images", initialdir=initial)

    if folder_path:
        root.deiconify()
        app = ImageDateEditor(root, folder_path)

        # Keyboard shortcuts
        def on_key(event):
            if event.keysym == 'Left':
                app.prev_image()
            elif event.keysym == 'Right':
                app.next_image()
            elif event.keysym == 'space':
                app.set_date()

        root.bind('<Key>', on_key)
        app.entry_date.focus_set()
        root.mainloop()
    else:
        messagebox.showinfo("Info", "No folder selected.")
        root.destroy()


if __name__ == "__main__":
    main()

