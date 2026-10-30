#!/usr/bin/env python3
"""Read-only HTTP delivery of precomputed XYZ PNG weather tiles."""
from __future__ import annotations

import argparse
from pathlib import Path
import re
from urllib.parse import parse_qs, unquote, urlsplit

from http_common import CLIENT_DISCONNECTS, LocalHandler, run_server
from raster_pipeline import DATA_DIR, cache_key, load_catalog, tile_bounds


def make_handler(root: Path, cache: Path, catalog=None):
    catalog = catalog or load_catalog(root)
    layers = {layer["id"]: layer for layer in catalog["layers"]}
    tile_keys = {name: cache_key(root, layer) for name, layer in layers.items()}

    class XyzHandler(LocalHandler):
        def do_GET(self):
            if self.serve_metrics():
                return
            url = urlsplit(self.path)
            try:
                if url.path in ("/", "/health"):
                    self.send_json({"service": "xyz", "layers": len(layers), "catalog": "/catalog.json",
                                    "xyz": "/tiles/<layer>/{z}/{x}/{y}.png",
                                    "xyzDelivery": "precomputed-only", "xyzColorRestyleSupported": False})
                elif url.path == "/catalog.json":
                    self.send_json(catalog)
                elif url.path.startswith("/tiles/"):
                    match = re.fullmatch(r"/tiles/([^/]+)/(\d+)/(\d+)/(\d+)\.png", unquote(url.path))
                    if not match or match[1] not in layers:
                        self.send_error(404, "Unknown tile or layer")
                        return
                    z, x, y = (int(match[i]) for i in (2, 3, 4))
                    params = {key.upper(): values[-1] for key, values in
                              parse_qs(url.query, keep_blank_values=True).items()}
                    if params.get("STYLE", "default") not in ("", "default"):
                        raise ValueError("Precomputed PNG tiles have fixed colors; color restyling is unsupported.")
                    tile_bounds(z, x, y)  # Validate coordinates without rendering.
                    path = cache / match[1] / tile_keys[match[1]] / str(z) / str(x) / f"{y}.png"
                    if not path.is_file():
                        self.send_error(404, "Precomputed PNG tile missing; run generate_xyz_tiles.py for this layer, zoom and region.")
                        return
                    # Unique URLs and no-store force independent HTTP/file reads between maps.
                    self.serve_file(path)
                else:
                    self.send_error(404, "Use /tiles/<layer>/<z>/<x>/<y>.png or /catalog.json")
            except (ValueError, KeyError) as error:
                self.send_json({"error": str(error)}, 400)
            except CLIENT_DISCONNECTS:
                raise
            except Exception as error:
                self.log_error("PNG request failed: %s", error)
                self.server_error("PNG file delivery failed. Check the server log.")
    return XyzHandler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cog-dir", type=Path, default=DATA_DIR / "cog")
    parser.add_argument("--tile-dir", type=Path, default=DATA_DIR / "wms_tiles")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8002)
    args = parser.parse_args()
    try:
        handler = make_handler(args.cog_dir.resolve(), args.tile_dir.resolve())
    except ValueError as error:
        parser.error(str(error))
    run_server(args.host, args.port, handler)


if __name__ == "__main__":
    main()
