# Licences

Microsoft Rocketbox Avatar Library (https://github.com/microsoft/Microsoft-Rocketbox), Copyright (c) 2020 Microsoft, MIT License. Gonzalez-Franco et al., The Rocketbox library and the utility of freely available rigged avatars, Frontiers in Virtual Reality 2020, doi:10.3389/frvir.2020.561558

All files: MIT, https://github.com/microsoft/Microsoft-Rocketbox/blob/master/LICENSE.md

Files here (all from the Rocketbox "lod2" level, taken from CodePawl's repack, https://huggingface.co/datasets/codepawl/rocketbox-avatars-glb, fetched 2026-11-15):

- female-adult-08, male-adult-03, female-adult-09, male-adult-17, female-adult-11, male-adult-10, business-female-03, male-adult-12, female-adult-06, police-male-03, male-adult-01, business-female-01, sports-female-02, female-adult-17, male-adult-04, male-adult-15, business-male-02, male-adult-08 and business-male-04 (nineteen files), each as `<id>_lod2.glb`.

Modified: every file here was processed by `tools/rocketbox/prepare-avatar.mjs`. It removes the face shapes (morph targets) and the face and finger bones from the skeleton (their vertex weights go to the Head and Hand bones), and rewrites the file; the meshes' triangles, vertex positions and the KTX2 textures are unchanged. Microsoft's licence text is in `LICENSE-Microsoft-Rocketbox.md`.
