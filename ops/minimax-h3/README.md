# Local MiniMax H3 render workers

These units run two independent ComfyUI workers on the Ubuntu render rig. Each
worker is pinned to one RTX PRO 6000 and listens only on the direct Cat6 address.
This lets the SandFest shot generator render two independent film sequences in
parallel without exposing ComfyUI on the public network.

Runtime paths:

- ComfyUI: `/mnt/emma/minimax-h3/ComfyUI`
- GPU 0 API: `http://10.10.10.2:8188`
- GPU 1 API: `http://10.10.10.2:8189`
- Generated media: `/mnt/emma/minimax-h3/ComfyUI/output/sandfest-h3`
- Worker state: `/mnt/emma/minimax-h3/ComfyUI/user-gpu0` and `user-gpu1`

Install the units on the Ubuntu rig:

```sh
sudo install -m 0644 sandfest-h3-gpu0.service sandfest-h3-gpu1.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl start sandfest-h3-gpu0.service sandfest-h3-gpu1.service
```

Confirm that Ollama has no resident GPU 0 model before starting the H3 GPU 0
worker. Do not remove its models or disable its unit. The H3 units are
intentionally not enabled at boot.

The local production sequence is:

```sh
npm run video:h3:generate
HF_HOME=/Volumes/ModelRAID/sandfest-chatterbox-turbo/hf \
  PYTORCH_ENABLE_MPS_FALLBACK=1 npm run video:h3:narration
npm run video:h3:score
npm run video:h3:render
npm run video:h3:transcribe
npm run video:h3:verify
```

The H3 generator uses one queue per GPU so independent shots render in parallel.
The final film combines reference-anchored H3 footage with real Playwright screen
captures; generated footage is never used to depict application UI.

After the batch, restore the original card power limits and the normal GPU 0
service:

```sh
sudo nvidia-smi -i 0 -pl 350
sudo nvidia-smi -i 1 -pl 600
sudo systemctl stop sandfest-h3-gpu0.service sandfest-h3-gpu1.service
sudo systemctl start ollama.service
curl -fsS http://127.0.0.1:11434/api/ps
```
