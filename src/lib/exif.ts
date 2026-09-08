// Minimal JPEG EXIF GPS reader — enough to pull coordinates out of a geotagged photo.
export function readExifGps(buffer: ArrayBuffer): { lat: number; lng: number } | null {
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;

  let offset = 2;
  while (offset < view.byteLength - 4) {
    if (view.getUint8(offset) !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = view.getUint8(offset + 1);
    const size = view.getUint16(offset + 2);
    if (marker === 0xe1) {
      const start = offset + 4;
      if (view.getUint32(start) !== 0x45786966) return null;
      return parseTiff(view, start + 6);
    }
    if (marker === 0xda) return null;
    offset += 2 + size;
  }
  return null;
}

function parseTiff(view: DataView, tiffStart: number): { lat: number; lng: number } | null {
  try {
    const little = view.getUint16(tiffStart) === 0x4949;
    const firstIfd = view.getUint32(tiffStart + 4, little);
    const dirStart = tiffStart + firstIfd;
    const entries = view.getUint16(dirStart, little);
    let gpsOffset = 0;
    for (let i = 0; i < entries; i++) {
      const entry = dirStart + 2 + i * 12;
      if (view.getUint16(entry, little) === 0x8825) {
        gpsOffset = tiffStart + view.getUint32(entry + 8, little);
      }
    }
    if (!gpsOffset) return null;

    const gpsEntries = view.getUint16(gpsOffset, little);
    let latRef = "N";
    let lngRef = "E";
    let lat: number | null = null;
    let lng: number | null = null;

    for (let i = 0; i < gpsEntries; i++) {
      const entry = gpsOffset + 2 + i * 12;
      const tag = view.getUint16(entry, little);
      const valueOffset = tiffStart + view.getUint32(entry + 8, little);
      if (tag === 1) latRef = String.fromCharCode(view.getUint8(entry + 8));
      if (tag === 3) lngRef = String.fromCharCode(view.getUint8(entry + 8));
      if (tag === 2) lat = readRational3(view, valueOffset, little);
      if (tag === 4) lng = readRational3(view, valueOffset, little);
    }

    if (lat === null || lng === null) return null;
    return {
      lat: latRef === "S" ? -lat : lat,
      lng: lngRef === "W" ? -lng : lng,
    };
  } catch {
    return null;
  }
}

function readRational3(view: DataView, offset: number, little: boolean) {
  const parts: number[] = [];
  for (let i = 0; i < 3; i++) {
    const num = view.getUint32(offset + i * 8, little);
    const den = view.getUint32(offset + i * 8 + 4, little);
    parts.push(den === 0 ? 0 : num / den);
  }
  return parts[0]! + parts[1]! / 60 + parts[2]! / 3600;
}
