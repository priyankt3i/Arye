// Config region (0x00–0xFF) read from a real Compx ARYE 8K receiver; used by ?demo.
export const DEMO_FLASH = Uint8Array.from(
  `10 45 04 51 01 54 00 55 00 55 01 54 07 07 00 47 0f 0f 00 37 1f 1f 00 17 3f 3f 00 d7 3f 3f 00 d7
   3f 3f 00 d7 3f 3f 00 d7 3f 3f 00 d7 ff 00 00 56 00 00 ff 56 ff ff 00 57 00 ff 00 56 00 ff 00 56
   00 ff 00 56 00 ff 00 56 00 ff 00 56 02 53 80 d5 03 52 00 55 ff 00 ff 57 00 55 80 d5 03 52 00 55
   01 01 00 53 01 02 00 52 01 04 00 50 01 08 00 4c 01 10 00 44 02 01 00 52 02 02 00 51 02 03 00 50
   07 00 00 4e 08 04 00 49 04 0a 03 44 00 00 00 55 00 00 00 55 00 00 00 55 00 00 00 55 00 00 00 55
   01 ff 00 ff 07 09 46 00 55 04 51 01 54 06 4f 00 55 00 55 00 55 00 55 06 4f 01 54 0a 4b 00 55 00
   55 80 d5 ff ff ff ff ff b1 47 6f f3 fb ff ff ff ff ff fe ff ff ff 5a ff ff ff ff ff ff ff ff ff
   ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff`
    .trim()
    .split(/\s+/)
    .map((h) => parseInt(h, 16)),
);
