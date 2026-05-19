(function () {
  "use strict";

  const TAGS = {
    DateTime: 0x0132,
    ExifIFDPointer: 0x8769,
    GPSIFDPointer: 0x8825,
    DateTimeOriginal: 0x9003,
    DateTimeDigitized: 0x9004,
    InteropIFDPointer: 0xa005,
    JPEGInterchangeFormat: 0x0201,
    JPEGInterchangeFormatLength: 0x0202,
  };

  const TAG_ORDER = [
    ["DateTimeOriginal", "ExifIFD.DateTimeOriginal"],
    ["DateTime", "IFD0.DateTime"],
    ["DateTimeDigitized", "ExifIFD.DateTimeDigitized"],
  ];

  const TYPE_ASCII = 2;
  const TYPE_LONG = 4;
  const TYPE_SIZES = {
    1: 1,
    2: 1,
    3: 2,
    4: 4,
    5: 8,
    6: 1,
    7: 1,
    8: 2,
    9: 4,
    10: 8,
    11: 4,
    12: 8,
    13: 4,
  };

  const EXIF_HEADER = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]);

  const state = {
    file: null,
    buffer: null,
    objectUrl: null,
    metadata: null,
  };

  const core = {
    parseExifDates,
    writeExifDates,
    isExifDateString,
    formatExifForDisplay,
  };

  globalThis.ExifDateEditorCore = core;

  if (typeof document === "undefined") {
    return;
  }

  const els = {
    dropZone: document.getElementById("dropZone"),
    fileInput: document.getElementById("fileInput"),
    message: document.getElementById("message"),
    editForm: document.getElementById("editForm"),
    dateInput: document.getElementById("dateInput"),
    timeInput: document.getElementById("timeInput"),
    secondsInput: document.getElementById("secondsInput"),
    downloadButton: document.getElementById("downloadButton"),
    previewWrap: document.querySelector(".preview-wrap"),
    previewImage: document.getElementById("previewImage"),
    fileFacts: document.getElementById("fileFacts"),
    metadataRows: document.getElementById("metadataRows"),
  };

  wireUi();
  resetUi();

  function wireUi() {
    els.fileInput.addEventListener("change", () => {
      const file = els.fileInput.files && els.fileInput.files[0];
      if (file) {
        void loadFile(file);
      }
    });

    for (const eventName of ["dragenter", "dragover"]) {
      els.dropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        els.dropZone.classList.add("is-dragging");
      });
    }

    for (const eventName of ["dragleave", "drop"]) {
      els.dropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        els.dropZone.classList.remove("is-dragging");
      });
    }

    els.dropZone.addEventListener("drop", (event) => {
      const file = event.dataTransfer.files && event.dataTransfer.files[0];
      if (file) {
        els.fileInput.value = "";
        void loadFile(file);
      }
    });

    for (const input of [els.dateInput, els.timeInput, els.secondsInput]) {
      input.addEventListener("input", updateDownloadState);
    }

    els.editForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void downloadEditedCopy();
    });
  }

  async function loadFile(file) {
    resetUi({ keepMessage: true });

    if (!looksLikeJpegFile(file)) {
      showMessage("This version only supports JPEG images.", "error");
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const metadata = parseExifDates(buffer);

      state.file = file;
      state.buffer = buffer;
      state.metadata = metadata;

      setPreview(file);
      renderFileFacts(file);
      renderMetadata(metadata);
      enableInputs(true);
      seedDateInputs(metadata);
      updateDownloadState();

      if (!metadata.hasExif) {
        showMessage(
          "No EXIF metadata was found. A new EXIF date block will be added.",
          "warning"
        );
      } else if (metadata.warnings.length) {
        showMessage(metadata.warnings.join(" "), "warning");
      } else {
        showMessage("JPEG loaded. Choose the replacement EXIF date.", "ok");
      }
    } catch (error) {
      resetUi();
      showMessage(error.message || "This file could not be read as a valid JPEG.", "error");
    }
  }

  async function downloadEditedCopy() {
    if (!state.buffer || !state.file) {
      return;
    }

    const exifDate = buildExifDateFromInputs();
    if (!exifDate) {
      showMessage("Choose a valid date and time before downloading.", "error");
      return;
    }

    try {
      const result = writeExifDates(state.buffer, exifDate);
      const blob = new Blob([result.buffer], { type: "image/jpeg" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = editedFilename(state.file.name);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);

      const suffix = result.warnings.length ? ` ${result.warnings.join(" ")}` : "";
      showMessage(`Edited copy created. ${suffix}`.trim(), result.warnings.length ? "warning" : "ok");
    } catch (error) {
      showMessage(
        error.message || "The date could not be written to this file. The original file was not changed.",
        "error"
      );
    }
  }

  function resetUi(options = {}) {
    state.file = null;
    state.buffer = null;
    state.metadata = null;
    enableInputs(false);
    els.dateInput.value = "";
    els.timeInput.value = "";
    els.secondsInput.value = "0";
    els.downloadButton.disabled = true;
    renderFileFacts(null);
    renderMetadata(null);

    if (state.objectUrl) {
      URL.revokeObjectURL(state.objectUrl);
      state.objectUrl = null;
    }
    els.previewImage.removeAttribute("src");
    els.previewWrap.classList.remove("has-image");

    if (!options.keepMessage) {
      showMessage("Select a JPEG to edit its embedded EXIF date.", "");
    }
  }

  function enableInputs(enabled) {
    els.dateInput.disabled = !enabled;
    els.timeInput.disabled = !enabled;
    els.secondsInput.disabled = !enabled;
  }

  function showMessage(text, kind) {
    els.message.textContent = text;
    els.message.className = "message";
    if (kind) {
      els.message.classList.add(`is-${kind}`);
    }
  }

  function setPreview(file) {
    if (state.objectUrl) {
      URL.revokeObjectURL(state.objectUrl);
    }
    state.objectUrl = URL.createObjectURL(file);
    els.previewImage.src = state.objectUrl;
    els.previewWrap.classList.add("has-image");
  }

  function renderFileFacts(file) {
    const values = file
      ? [file.name, formatBytes(file.size), file.type || "image/jpeg"]
      : ["-", "-", "-"];
    const dds = els.fileFacts.querySelectorAll("dd");
    dds.forEach((dd, index) => {
      dd.textContent = values[index];
    });
  }

  function renderMetadata(metadata) {
    els.metadataRows.textContent = "";
    const dates = metadata ? metadata.dates : {};

    for (const [key, label] of TAG_ORDER) {
      const row = document.createElement("tr");
      const tagCell = document.createElement("td");
      const valueCell = document.createElement("td");
      const value = dates[key];

      tagCell.textContent = label;
      if (!value) {
        valueCell.textContent = "-";
      } else if (value.valid) {
        valueCell.textContent = formatExifForDisplay(value.raw);
      } else {
        const invalid = document.createElement("span");
        invalid.className = "invalid-value";
        invalid.textContent = value.raw || "Invalid value";
        const stateText = document.createElement("span");
        stateText.className = "tag-state";
        stateText.textContent = "invalid";
        valueCell.append(invalid, stateText);
      }

      row.append(tagCell, valueCell);
      els.metadataRows.append(row);
    }
  }

  function seedDateInputs(metadata) {
    const preferred = [
      metadata.dates.DateTimeOriginal,
      metadata.dates.DateTime,
      metadata.dates.DateTimeDigitized,
    ].find((value) => value && value.valid);
    if (!preferred) {
      return;
    }
    const parts = parseExifDateParts(preferred.raw);
    els.dateInput.value = `${pad4(parts.year)}-${pad2(parts.month)}-${pad2(parts.day)}`;
    els.timeInput.value = `${pad2(parts.hour)}:${pad2(parts.minute)}`;
    els.secondsInput.value = String(parts.second);
  }

  function updateDownloadState() {
    els.downloadButton.disabled = !state.buffer || !buildExifDateFromInputs();
  }

  function buildExifDateFromInputs() {
    if (!els.dateInput.value || !els.timeInput.value) {
      return null;
    }

    const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(els.dateInput.value);
    const timeMatch = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(els.timeInput.value);
    const secondsText = els.secondsInput.value === "" ? "0" : els.secondsInput.value;
    const seconds = Number(secondsText);

    if (!dateMatch || !timeMatch || !Number.isInteger(seconds) || seconds < 0 || seconds > 59) {
      return null;
    }

    const year = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    const day = Number(dateMatch[3]);
    const hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2]);
    const second = seconds;

    if (!isRealDate(year, month, day, hour, minute, second)) {
      return null;
    }

    return `${pad4(year)}:${pad2(month)}:${pad2(day)} ${pad2(hour)}:${pad2(minute)}:${pad2(second)}`;
  }

  function looksLikeJpegFile(file) {
    const name = file.name.toLowerCase();
    return (
      name.endsWith(".jpg") ||
      name.endsWith(".jpeg") ||
      file.type === "image/jpeg" ||
      file.type === ""
    );
  }

  function editedFilename(name) {
    const withoutExtension = name.replace(/\.[^.]+$/, "");
    return `${withoutExtension || "image"}_exif-date-edited.jpg`;
  }

  function formatBytes(size) {
    if (!Number.isFinite(size)) {
      return "-";
    }
    const units = ["B", "KB", "MB", "GB"];
    let value = size;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
  }

  function parseExifDates(buffer) {
    const bytes = new Uint8Array(buffer);
    const segments = parseJpegSegments(bytes);
    const exifSegment = findExifSegment(bytes, segments);

    if (!exifSegment) {
      return {
        hasExif: false,
        dates: {},
        warnings: [],
      };
    }

    const tiffStart = exifSegment.payloadStart + EXIF_HEADER.length;
    const tiffBytes = bytes.slice(tiffStart, exifSegment.payloadEnd);
    const parsed = parseTiff(tiffBytes);

    return {
      hasExif: true,
      dates: readManagedDates(parsed),
      warnings: parsed.warnings,
    };
  }

  function writeExifDates(buffer, exifDate) {
    if (!isExifDateString(exifDate)) {
      throw new Error("The selected date cannot be converted to a valid EXIF date.");
    }

    const bytes = new Uint8Array(buffer);
    const segments = parseJpegSegments(bytes);
    const exifSegment = findExifSegment(bytes, segments);
    const warnings = [];

    if (!exifSegment) {
      const tiff = buildMinimalTiff(exifDate, false);
      const app1 = buildExifApp1Segment(tiff);
      const insertAt = findExifInsertOffset(segments);
      warnings.push("A new EXIF block was added because none was present.");
      return {
        buffer: spliceBytes(bytes, insertAt, insertAt, app1),
        warnings,
      };
    }

    const tiffStart = exifSegment.payloadStart + EXIF_HEADER.length;
    const tiffBytes = bytes.slice(tiffStart, exifSegment.payloadEnd);
    const parsed = parseTiff(tiffBytes);
    const targets = managedDateEntries(parsed);

    if (canPatchInPlace(targets, tiffBytes.length)) {
      const out = new Uint8Array(bytes);
      const dateBytes = exifDateBytes(exifDate);
      for (const entry of Object.values(targets)) {
        const writeAt = tiffStart + entry.dataOffset;
        out.set(dateBytes, writeAt);
        for (let i = dateBytes.length; i < entry.byteCount; i += 1) {
          out[writeAt + i] = 0;
        }
      }
      return {
        buffer: out.buffer,
        warnings,
      };
    }

    const rebuiltTiff = rebuildTiff(parsed, exifDate);
    const app1 = buildExifApp1Segment(rebuiltTiff);
    warnings.push(
      "The EXIF block was rebuilt so missing date tags could be inserted. Image pixels were not recompressed."
    );
    return {
      buffer: spliceBytes(bytes, exifSegment.start, exifSegment.end, app1),
      warnings,
    };
  }

  function parseJpegSegments(bytes) {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      throw new Error("This file could not be read as a valid JPEG.");
    }

    const segments = [];
    let offset = 2;

    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) {
        break;
      }

      const markerStart = offset;
      while (offset < bytes.length && bytes[offset] === 0xff) {
        offset += 1;
      }
      if (offset >= bytes.length) {
        break;
      }

      const marker = bytes[offset];
      offset += 1;

      if (marker === 0x00) {
        throw new Error("This file could not be read as a valid JPEG.");
      }

      if (marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        segments.push({
          marker,
          start: markerStart,
          end: offset,
          payloadStart: offset,
          payloadEnd: offset,
        });
        if (marker === 0xd9) {
          break;
        }
        continue;
      }

      if (offset + 2 > bytes.length) {
        throw new Error("This file could not be read as a valid JPEG.");
      }

      const length = readU16BE(bytes, offset);
      if (length < 2 || offset + length > bytes.length) {
        throw new Error("This file could not be read as a valid JPEG.");
      }

      const payloadStart = offset + 2;
      const payloadEnd = offset + length;
      const end = payloadEnd;
      segments.push({
        marker,
        start: markerStart,
        lengthOffset: offset,
        payloadStart,
        payloadEnd,
        end,
      });

      offset = end;
      if (marker === 0xda) {
        break;
      }
    }

    return segments;
  }

  function findExifSegment(bytes, segments) {
    return segments.find((segment) => {
      if (segment.marker !== 0xe1) {
        return false;
      }
      if (segment.payloadEnd - segment.payloadStart < EXIF_HEADER.length) {
        return false;
      }
      for (let i = 0; i < EXIF_HEADER.length; i += 1) {
        if (bytes[segment.payloadStart + i] !== EXIF_HEADER[i]) {
          return false;
        }
      }
      return true;
    });
  }

  function findExifInsertOffset(segments) {
    let offset = 2;
    for (const segment of segments) {
      if (segment.start !== offset || segment.marker !== 0xe0) {
        break;
      }
      offset = segment.end;
    }
    return offset;
  }

  function parseTiff(tiff) {
    if (tiff.length < 8) {
      throw new Error("The EXIF metadata is too small to edit.");
    }

    const byteOrder = String.fromCharCode(tiff[0], tiff[1]);
    const little = byteOrder === "II";
    if (!little && byteOrder !== "MM") {
      throw new Error("The EXIF byte order is not recognized.");
    }
    if (readU16(tiff, 2, little) !== 42) {
      throw new Error("The EXIF TIFF header is not recognized.");
    }

    const firstIfdOffset = readU32(tiff, 4, little);
    const parsed = {
      tiff,
      little,
      firstIfdOffset,
      ifds: new Map(),
      warnings: [],
    };
    const visited = new Set();
    const ifd0 = parseIfdAt(parsed, "IFD0", firstIfdOffset, visited);
    if (!ifd0) {
      throw new Error("The EXIF IFD0 directory is missing or unreadable.");
    }

    const exifPointer = getLongValue(findEntry(ifd0, TAGS.ExifIFDPointer), parsed);
    if (exifPointer) {
      parseIfdAt(parsed, "ExifIFD", exifPointer, visited);
    }

    const gpsPointer = getLongValue(findEntry(ifd0, TAGS.GPSIFDPointer), parsed);
    if (gpsPointer) {
      parseIfdAt(parsed, "GPS", gpsPointer, visited);
    }

    const ifd1Offset = ifd0.nextOffset;
    if (ifd1Offset) {
      parseIfdAt(parsed, "IFD1", ifd1Offset, visited);
    }

    const exifIfd = parsed.ifds.get("ExifIFD");
    const interopPointer = exifIfd
      ? getLongValue(findEntry(exifIfd, TAGS.InteropIFDPointer), parsed)
      : 0;
    if (interopPointer) {
      parseIfdAt(parsed, "Interop", interopPointer, visited);
    }

    return parsed;
  }

  function parseIfdAt(parsed, name, offset, visited) {
    const tiff = parsed.tiff;
    if (!Number.isInteger(offset) || offset <= 0 || offset + 2 > tiff.length) {
      parsed.warnings.push(`${name} points outside the EXIF block.`);
      return null;
    }
    if (visited.has(offset)) {
      return null;
    }
    visited.add(offset);

    const count = readU16(tiff, offset, parsed.little);
    const entriesStart = offset + 2;
    const entriesEnd = entriesStart + count * 12;
    const nextOffsetPosition = entriesEnd;
    if (entriesEnd + 4 > tiff.length) {
      parsed.warnings.push(`${name} is truncated.`);
      return null;
    }

    const entries = [];
    for (let i = 0; i < count; i += 1) {
      const entryOffset = entriesStart + i * 12;
      const tag = readU16(tiff, entryOffset, parsed.little);
      const type = readU16(tiff, entryOffset + 2, parsed.little);
      const valueCount = readU32(tiff, entryOffset + 4, parsed.little);
      const byteCount = entryByteCount(type, valueCount);
      const valueFieldOffset = entryOffset + 8;
      const inline = byteCount <= 4;
      const dataOffset = inline ? valueFieldOffset : readU32(tiff, valueFieldOffset, parsed.little);
      let valueBytes;

      if (inline) {
        valueBytes = tiff.slice(valueFieldOffset, valueFieldOffset + Math.min(byteCount, 4));
      } else if (dataOffset + byteCount <= tiff.length) {
        valueBytes = tiff.slice(dataOffset, dataOffset + byteCount);
      } else {
        valueBytes = new Uint8Array(0);
        parsed.warnings.push(`Tag 0x${tag.toString(16)} points outside the EXIF block.`);
      }

      entries.push({
        tag,
        type,
        count: valueCount,
        byteCount,
        valueFieldOffset,
        inline,
        dataOffset,
        valueBytes,
      });
    }

    const ifd = {
      name,
      offset,
      entries,
      nextOffset: readU32(tiff, nextOffsetPosition, parsed.little),
    };
    parsed.ifds.set(name, ifd);
    return ifd;
  }

  function readManagedDates(parsed) {
    const entries = managedDateEntries(parsed);
    const out = {};

    for (const [name, entry] of Object.entries(entries)) {
      if (!entry) {
        continue;
      }
      if (entry.type !== TYPE_ASCII || !entry.valueBytes.length) {
        out[name] = {
          raw: "",
          valid: false,
        };
        continue;
      }
      const raw = decodeAscii(entry.valueBytes);
      out[name] = {
        raw,
        valid: isExifDateString(raw),
      };
    }

    return out;
  }

  function managedDateEntries(parsed) {
    const ifd0 = parsed.ifds.get("IFD0");
    const exifIfd = parsed.ifds.get("ExifIFD");
    return {
      DateTimeOriginal: exifIfd ? findEntry(exifIfd, TAGS.DateTimeOriginal) : null,
      DateTime: ifd0 ? findEntry(ifd0, TAGS.DateTime) : null,
      DateTimeDigitized: exifIfd ? findEntry(exifIfd, TAGS.DateTimeDigitized) : null,
    };
  }

  function canPatchInPlace(entries, tiffLength) {
    return Object.values(entries).every((entry) => {
      return (
        entry &&
        entry.type === TYPE_ASCII &&
        entry.byteCount >= 20 &&
        entry.dataOffset >= 0 &&
        entry.dataOffset + 20 <= tiffLength
      );
    });
  }

  function rebuildTiff(parsed, exifDate) {
    const dateBytes = exifDateBytes(exifDate);
    const ifds = new Map();

    addSerializableIfd(ifds, parsed, "IFD0");
    addSerializableIfd(ifds, parsed, "ExifIFD");
    if (parsed.ifds.has("GPS")) {
      addSerializableIfd(ifds, parsed, "GPS");
    }
    if (parsed.ifds.has("Interop")) {
      addSerializableIfd(ifds, parsed, "Interop");
    }
    if (parsed.ifds.has("IFD1")) {
      addSerializableIfd(ifds, parsed, "IFD1");
    }

    const ifd0 = ifds.get("IFD0");
    const exifIfd = ifds.get("ExifIFD");
    setPointerEntry(ifd0, TAGS.ExifIFDPointer, "ExifIFD");
    setAsciiEntry(ifd0, TAGS.DateTime, dateBytes);
    setAsciiEntry(exifIfd, TAGS.DateTimeOriginal, dateBytes);
    setAsciiEntry(exifIfd, TAGS.DateTimeDigitized, dateBytes);

    if (ifds.has("GPS")) {
      setPointerEntry(ifd0, TAGS.GPSIFDPointer, "GPS");
    }
    if (ifds.has("Interop")) {
      setPointerEntry(exifIfd, TAGS.InteropIFDPointer, "Interop");
    }
    if (ifds.has("IFD1")) {
      ifd0.nextName = "IFD1";
    }

    return serializeTiff(ifds, parsed.little);
  }

  function addSerializableIfd(ifds, parsed, name) {
    const source = parsed.ifds.get(name);
    const entries = [];

    if (source) {
      const thumbnail = name === "IFD1" ? readThumbnail(parsed, source) : null;
      for (const entry of source.entries) {
        if (shouldSkipForRebuild(name, entry.tag)) {
          continue;
        }
        if (thumbnail && entry.tag === TAGS.JPEGInterchangeFormat) {
          entries.push({
            tag: entry.tag,
            type: TYPE_LONG,
            count: 1,
            pointsToData: true,
            dataBytes: thumbnail,
          });
          continue;
        }
        if (thumbnail && entry.tag === TAGS.JPEGInterchangeFormatLength) {
          entries.push(longEntry(entry.tag, thumbnail.length, parsed.little));
          continue;
        }
        entries.push(cloneEntry(entry));
      }
    }

    ifds.set(name, {
      name,
      entries,
      nextName: null,
      offset: 0,
    });
  }

  function shouldSkipForRebuild(ifdName, tag) {
    if (ifdName === "IFD0") {
      return tag === TAGS.DateTime || tag === TAGS.ExifIFDPointer || tag === TAGS.GPSIFDPointer;
    }
    if (ifdName === "ExifIFD") {
      return (
        tag === TAGS.DateTimeOriginal ||
        tag === TAGS.DateTimeDigitized ||
        tag === TAGS.InteropIFDPointer
      );
    }
    return false;
  }

  function cloneEntry(entry) {
    if (entry.byteCount > 4 && entry.valueBytes.length !== entry.byteCount) {
      throw new Error("The EXIF metadata contains truncated tag data and cannot be safely rebuilt.");
    }
    return {
      tag: entry.tag,
      type: entry.type,
      count: entry.count,
      byteCount: entry.byteCount,
      valueBytes: entry.valueBytes.slice(),
    };
  }

  function readThumbnail(parsed, ifd) {
    const offsetEntry = findEntry(ifd, TAGS.JPEGInterchangeFormat);
    const lengthEntry = findEntry(ifd, TAGS.JPEGInterchangeFormatLength);
    const offset = getLongValue(offsetEntry, parsed);
    const length = getLongValue(lengthEntry, parsed);
    if (!offset || !length || offset + length > parsed.tiff.length) {
      return null;
    }
    return parsed.tiff.slice(offset, offset + length);
  }

  function setAsciiEntry(ifd, tag, valueBytes) {
    removeEntries(ifd, tag);
    ifd.entries.push({
      tag,
      type: TYPE_ASCII,
      count: valueBytes.length,
      byteCount: valueBytes.length,
      valueBytes: valueBytes.slice(),
    });
  }

  function setPointerEntry(ifd, tag, targetIfdName) {
    removeEntries(ifd, tag);
    ifd.entries.push({
      tag,
      type: TYPE_LONG,
      count: 1,
      byteCount: 4,
      targetIfdName,
      valueBytes: new Uint8Array(4),
    });
  }

  function removeEntries(ifd, tag) {
    ifd.entries = ifd.entries.filter((entry) => entry.tag !== tag);
  }

  function longEntry(tag, value, little) {
    const valueBytes = new Uint8Array(4);
    writeU32(valueBytes, 0, value, little);
    return {
      tag,
      type: TYPE_LONG,
      count: 1,
      byteCount: 4,
      valueBytes,
    };
  }

  function serializeTiff(ifds, little) {
    const order = ["IFD0", "ExifIFD", "GPS", "Interop", "IFD1"].filter((name) => ifds.has(name));

    let cursor = 8;
    for (const name of order) {
      const ifd = ifds.get(name);
      ifd.entries.sort((a, b) => a.tag - b.tag);
      ifd.offset = cursor;
      cursor += 2 + ifd.entries.length * 12 + 4;
    }
    cursor = align2(cursor);

    for (const name of order) {
      const ifd = ifds.get(name);
      for (const entry of ifd.entries) {
        const byteCount = serialEntryByteCount(entry);
        if (entry.pointsToData) {
          cursor = align2(cursor);
          entry.pointerDataOffset = cursor;
          cursor += entry.dataBytes.length;
        } else if (!entry.targetIfdName && byteCount > 4) {
          cursor = align2(cursor);
          entry.dataOffset = cursor;
          cursor += byteCount;
        }
      }
    }

    const out = new Uint8Array(cursor);
    out[0] = little ? 0x49 : 0x4d;
    out[1] = little ? 0x49 : 0x4d;
    writeU16(out, 2, 42, little);
    writeU32(out, 4, ifds.get("IFD0").offset, little);

    for (const name of order) {
      const ifd = ifds.get(name);
      writeU16(out, ifd.offset, ifd.entries.length, little);
      let entryOffset = ifd.offset + 2;

      for (const entry of ifd.entries) {
        const byteCount = serialEntryByteCount(entry);
        writeU16(out, entryOffset, entry.tag, little);
        writeU16(out, entryOffset + 2, entry.type, little);
        writeU32(out, entryOffset + 4, entry.count, little);

        if (entry.targetIfdName) {
          const target = ifds.get(entry.targetIfdName);
          writeU32(out, entryOffset + 8, target ? target.offset : 0, little);
        } else if (entry.pointsToData) {
          writeU32(out, entryOffset + 8, entry.pointerDataOffset, little);
          out.set(entry.dataBytes, entry.pointerDataOffset);
        } else if (byteCount > 4) {
          writeU32(out, entryOffset + 8, entry.dataOffset, little);
          writeEntryValue(out, entry.dataOffset, entry.valueBytes, byteCount);
        } else {
          writeEntryValue(out, entryOffset + 8, entry.valueBytes, byteCount);
        }

        entryOffset += 12;
      }

      const nextOffset = ifd.nextName && ifds.has(ifd.nextName) ? ifds.get(ifd.nextName).offset : 0;
      writeU32(out, ifd.offset + 2 + ifd.entries.length * 12, nextOffset, little);
    }

    return out;
  }

  function buildMinimalTiff(exifDate, little) {
    const dateBytes = exifDateBytes(exifDate);
    const ifds = new Map();
    ifds.set("IFD0", {
      name: "IFD0",
      entries: [],
      nextName: null,
      offset: 0,
    });
    ifds.set("ExifIFD", {
      name: "ExifIFD",
      entries: [],
      nextName: null,
      offset: 0,
    });
    setAsciiEntry(ifds.get("IFD0"), TAGS.DateTime, dateBytes);
    setPointerEntry(ifds.get("IFD0"), TAGS.ExifIFDPointer, "ExifIFD");
    setAsciiEntry(ifds.get("ExifIFD"), TAGS.DateTimeOriginal, dateBytes);
    setAsciiEntry(ifds.get("ExifIFD"), TAGS.DateTimeDigitized, dateBytes);
    return serializeTiff(ifds, little);
  }

  function buildExifApp1Segment(tiff) {
    const payloadLength = EXIF_HEADER.length + tiff.length;
    const segmentLength = payloadLength + 2;
    if (segmentLength > 0xffff) {
      throw new Error("The edited EXIF metadata is too large for one JPEG APP1 segment.");
    }

    const segment = new Uint8Array(2 + segmentLength);
    segment[0] = 0xff;
    segment[1] = 0xe1;
    writeU16BE(segment, 2, segmentLength);
    segment.set(EXIF_HEADER, 4);
    segment.set(tiff, 4 + EXIF_HEADER.length);
    return segment;
  }

  function spliceBytes(bytes, start, end, replacement) {
    const out = new Uint8Array(bytes.length - (end - start) + replacement.length);
    out.set(bytes.subarray(0, start), 0);
    out.set(replacement, start);
    out.set(bytes.subarray(end), start + replacement.length);
    return out.buffer;
  }

  function findEntry(ifd, tag) {
    return ifd.entries.find((entry) => entry.tag === tag) || null;
  }

  function getLongValue(entry, parsed) {
    if (!entry || entry.type !== TYPE_LONG || entry.count !== 1) {
      return 0;
    }
    if (entry.valueBytes.length >= 4) {
      return readU32(entry.valueBytes, 0, parsed.little);
    }
    return 0;
  }

  function serialEntryByteCount(entry) {
    if (entry.targetIfdName || entry.pointsToData) {
      return 4;
    }
    if (entry.byteCount != null) {
      return entry.byteCount;
    }
    return entryByteCount(entry.type, entry.count);
  }

  function entryByteCount(type, count) {
    const size = TYPE_SIZES[type];
    if (!size || !Number.isFinite(count)) {
      return 0;
    }
    return size * count;
  }

  function writeEntryValue(out, offset, valueBytes, byteCount) {
    const size = Math.min(valueBytes.length, byteCount);
    out.set(valueBytes.subarray(0, size), offset);
  }

  function exifDateBytes(value) {
    if (!isExifDateString(value)) {
      throw new Error("The selected date cannot be converted to a valid EXIF date.");
    }
    const out = new Uint8Array(20);
    for (let i = 0; i < value.length; i += 1) {
      out[i] = value.charCodeAt(i);
    }
    out[19] = 0;
    return out;
  }

  function decodeAscii(bytes) {
    let out = "";
    for (const byte of bytes) {
      if (byte === 0) {
        break;
      }
      out += String.fromCharCode(byte);
    }
    return out;
  }

  function isExifDateString(value) {
    return Boolean(parseExifDateParts(value));
  }

  function parseExifDateParts(value) {
    const match = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value || "");
    if (!match) {
      return null;
    }
    const parts = {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      hour: Number(match[4]),
      minute: Number(match[5]),
      second: Number(match[6]),
    };
    if (!isRealDate(parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second)) {
      return null;
    }
    return parts;
  }

  function formatExifForDisplay(value) {
    const parts = parseExifDateParts(value);
    if (!parts) {
      return value || "-";
    }
    return `${pad4(parts.year)}-${pad2(parts.month)}-${pad2(parts.day)} ${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}`;
  }

  function isRealDate(year, month, day, hour, minute, second) {
    const date = new Date(year, month - 1, day, hour, minute, second);
    return (
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day &&
      date.getHours() === hour &&
      date.getMinutes() === minute &&
      date.getSeconds() === second
    );
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function pad4(value) {
    return String(value).padStart(4, "0");
  }

  function align2(value) {
    return value % 2 === 0 ? value : value + 1;
  }

  function readU16BE(bytes, offset) {
    return (bytes[offset] << 8) | bytes[offset + 1];
  }

  function writeU16BE(bytes, offset, value) {
    bytes[offset] = (value >>> 8) & 0xff;
    bytes[offset + 1] = value & 0xff;
  }

  function readU16(bytes, offset, little) {
    if (offset + 2 > bytes.length) {
      return 0;
    }
    return little ? bytes[offset] | (bytes[offset + 1] << 8) : (bytes[offset] << 8) | bytes[offset + 1];
  }

  function readU32(bytes, offset, little) {
    if (offset + 4 > bytes.length) {
      return 0;
    }
    if (little) {
      return (
        bytes[offset] |
        (bytes[offset + 1] << 8) |
        (bytes[offset + 2] << 16) |
        (bytes[offset + 3] << 24)
      ) >>> 0;
    }
    return (
      ((bytes[offset] << 24) >>> 0) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]
    ) >>> 0;
  }

  function writeU16(bytes, offset, value, little) {
    if (little) {
      bytes[offset] = value & 0xff;
      bytes[offset + 1] = (value >>> 8) & 0xff;
    } else {
      bytes[offset] = (value >>> 8) & 0xff;
      bytes[offset + 1] = value & 0xff;
    }
  }

  function writeU32(bytes, offset, value, little) {
    const normalized = value >>> 0;
    if (little) {
      bytes[offset] = normalized & 0xff;
      bytes[offset + 1] = (normalized >>> 8) & 0xff;
      bytes[offset + 2] = (normalized >>> 16) & 0xff;
      bytes[offset + 3] = (normalized >>> 24) & 0xff;
    } else {
      bytes[offset] = (normalized >>> 24) & 0xff;
      bytes[offset + 1] = (normalized >>> 16) & 0xff;
      bytes[offset + 2] = (normalized >>> 8) & 0xff;
      bytes[offset + 3] = normalized & 0xff;
    }
  }
})();
