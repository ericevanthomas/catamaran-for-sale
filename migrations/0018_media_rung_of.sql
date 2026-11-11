-- Is this row a photograph, or just one width of another one?
--
-- The demo seeded 90 media rows from the pre-R2 build pipeline, which wrote
-- each responsive width out as its OWN upload: "About shop", "About shop 480"
-- and "About shop 800" were three hash folders holding the same picture. Only
-- ~62 of the 90 are distinct photographs. The client sees all 90 in the
-- editor's photo picker and can pick the 480px one for a hero.
--
-- That shape is also obsolete. A photo is a FOLDER now
-- (functions/api/media.ts): uploads/<hash>/480.webp, 800.webp, 1600.webp live
-- side by side, so ONE upload is already a complete responsive set and the
-- extra folders carry nothing the real one does not already hold.
--
--   NULL      a photograph — the picker lists it
--   <src>     one width of the photograph at that src — the picker hides it
--
-- ── why not overload `master` ───────────────────────────────────────────────
-- 0016's `master` answers a different question: do we hold the lossless
-- original? All 28 of these rows DO (uploads/<hash>/master.webp is in the
-- bucket), so writing a marker over 'stored' would throw away a fact we
-- cannot recover, and functions/api/media.ts already runs
-- `UPDATE media SET master = 'stored'` when a background master lands — which
-- would silently un-mark the row. Two facts, two columns.
--
-- ── reversing this ──────────────────────────────────────────────────────────
-- The rows, their srcsets and every R2 object are untouched; only this one
-- column was written. To put all 90 back in the picker:
--
--   npx wrangler d1 execute rp-fourlakes --remote \
--     --command "UPDATE media SET rung_of = NULL"
--
-- The column itself can stay: with every value NULL it is inert.
ALTER TABLE media ADD COLUMN rung_of TEXT;

-- The 28 rungs the seed created, each pointed at the photograph it is a width
-- of. Derived from the srcsets src/config/image-variants.json carried before
-- they were rewritten to reference only their own folder, and cross-checked
-- against the "<title> <width>" naming — the two agree on all 28 rows.
UPDATE media SET rung_of = '/media/uploads/5f79bae02601dba2cb10fc9ffc2ab697/1434.webp' WHERE src = '/media/uploads/036897577676bb8e7c0f15d6e465e815/660.webp';
UPDATE media SET rung_of = '/media/uploads/8109acb5c2a2c04384cc9c056ec5a5b6/1600.webp' WHERE src = '/media/uploads/0497d60bbd59bceae0db270af57bb900/800.webp';
UPDATE media SET rung_of = '/media/uploads/3d8bd4788a8f26e7f12e5a0e98c9b739/1400.webp' WHERE src = '/media/uploads/11f833a9eb561eba239723b3c6579be0/800.webp';
UPDATE media SET rung_of = '/media/uploads/7feaba5a743e4f3400bbee9eb069cb20/1434.webp' WHERE src = '/media/uploads/1c2b69df68893ba25bfd20e181aee012/800.webp';
UPDATE media SET rung_of = '/media/uploads/e920a2401adb4545a267b473321a6823/1600.webp' WHERE src = '/media/uploads/1d78e649f81fc5609e3f3f10b56d90fb/740.webp';
UPDATE media SET rung_of = '/media/uploads/2ba5633dc7966952fbb00242a1197d31/1400.webp' WHERE src = '/media/uploads/29ac0cecc0bedbbd2b5194648cf4261b/660.webp';
UPDATE media SET rung_of = '/media/uploads/b308dcc98d134bd0410b61954bff6203/1434.webp' WHERE src = '/media/uploads/2a4ba12fefe6aceb697071f17206830c/800.webp';
UPDATE media SET rung_of = '/media/uploads/805f18789005a8a1c4003740da317877/1434.webp' WHERE src = '/media/uploads/41775c47a788b9838b9e7a90247db2af/480.webp';
UPDATE media SET rung_of = '/media/uploads/a4e3d93064da44c1fa95d2c93b4433c0/1400.webp' WHERE src = '/media/uploads/495c634e6b378ffa8a53c891668079e9/660.webp';
UPDATE media SET rung_of = '/media/uploads/2ba5633dc7966952fbb00242a1197d31/1400.webp' WHERE src = '/media/uploads/49cf34efc3e4c77226d8702810dc0d21/800.webp';
UPDATE media SET rung_of = '/media/uploads/768664a5b616fd56669d04015fd60636/1600.webp' WHERE src = '/media/uploads/54a38401cc8005fcaf7a113b1beb6f7d/480.webp';
UPDATE media SET rung_of = '/media/uploads/a4e3d93064da44c1fa95d2c93b4433c0/1400.webp' WHERE src = '/media/uploads/5eae177e3a71782624ca0aca12fc5e49/800.webp';
UPDATE media SET rung_of = '/media/uploads/e920a2401adb4545a267b473321a6823/1600.webp' WHERE src = '/media/uploads/761566b5493b70d26e45e3beffcbb5e6/1280.webp';
UPDATE media SET rung_of = '/media/uploads/768664a5b616fd56669d04015fd60636/1600.webp' WHERE src = '/media/uploads/905acee6f983b921b3b2f30d1478c898/800.webp';
UPDATE media SET rung_of = '/media/uploads/99800c08fc916a23675e756f02d28c5e/1434.webp' WHERE src = '/media/uploads/94094fb2f2870d4f75695210d7f4585e/800.webp';
UPDATE media SET rung_of = '/media/uploads/5f6518592315404e105ab21983dc69ad/1400.webp' WHERE src = '/media/uploads/988d2c68b094310bcac19811a192d1bc/800.webp';
UPDATE media SET rung_of = '/media/uploads/0c5fc68853acc936e68c4b8c77f7b046/1434.webp' WHERE src = '/media/uploads/b073ec5df0ad1e0feffcd0d723c38caf/800.webp';
UPDATE media SET rung_of = '/media/uploads/d543f591a0b85b2fb5cdeed13350cb66/1434.webp' WHERE src = '/media/uploads/b0c8eb7a1822a18c577539b0c57767e3/800.webp';
UPDATE media SET rung_of = '/media/uploads/5f79bae02601dba2cb10fc9ffc2ab697/1434.webp' WHERE src = '/media/uploads/b938e4aedb188850bb96f669f14caed1/800.webp';
UPDATE media SET rung_of = '/media/uploads/6fa0b5a0105845e12b82a9c0052b7026/1434.webp' WHERE src = '/media/uploads/c7e0e19e50a0a1bbca830749f73c6399/800.webp';
UPDATE media SET rung_of = '/media/uploads/20709625f16e7e1da062bc2848c84c0e/1434.webp' WHERE src = '/media/uploads/cacdf80d916c8b4347f52b8862c79802/660.webp';
UPDATE media SET rung_of = '/media/uploads/bf235060c004f69afebd89be41f76240/1434.webp' WHERE src = '/media/uploads/ce12317b24daa6f366af60c2679fec1e/800.webp';
UPDATE media SET rung_of = '/media/uploads/20709625f16e7e1da062bc2848c84c0e/1434.webp' WHERE src = '/media/uploads/d0bec73392eafd067a7b774d03489b04/800.webp';
UPDATE media SET rung_of = '/media/uploads/3d8bd4788a8f26e7f12e5a0e98c9b739/1400.webp' WHERE src = '/media/uploads/df3deceb4b45a1382da1a854ce7a1665/660.webp';
UPDATE media SET rung_of = '/media/uploads/8109acb5c2a2c04384cc9c056ec5a5b6/1600.webp' WHERE src = '/media/uploads/e3393184d2b7cf449ed006a24f1855fd/480.webp';
UPDATE media SET rung_of = '/media/uploads/805f18789005a8a1c4003740da317877/1434.webp' WHERE src = '/media/uploads/e5353544caf8b246b0e6567b856d4d86/800.webp';
UPDATE media SET rung_of = '/media/uploads/5f6518592315404e105ab21983dc69ad/1400.webp' WHERE src = '/media/uploads/f146258cd66650c064ede6a86b7d94bb/660.webp';
UPDATE media SET rung_of = '/media/uploads/a85b8aafd7e5147a2634f2a6a828f88f/1434.webp' WHERE src = '/media/uploads/fb50727ffb2b351d10b916a8d4df77e6/800.webp';
