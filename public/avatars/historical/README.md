# Historical likenesses

These are the 71 existing painted portraits from AlchmAgentsSolana, matched by
canonical historical-agent ID. They remain in profiles, the roster and cards,
and provide the source for the offline [3D face bake](../faces/README.md).
The articulated heads use estimated mesh geometry and vertex colors derived
from these pictures; they do not display a portrait plane or image texture.
Failed face loads leave the original procedural head usable.

Rebuild offline with:

```sh
node scripts/sync-avatar-portraits.mjs /path/to/AlchmAgentsSolana
```

The script uses Sharp already installed in that source checkout. No new package,
generation service, network call or runtime image transformation is required.
`sources.json` records source paths and SHA-256 hashes of the original PNG files.
All images retain their original 512×512 resolution and are encoded as WebP
quality 82, totaling 3,518,658 bytes (original PNGs: 33,242,279 bytes).
