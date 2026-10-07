# The runner image for CI jobs served by Nick's Hearthstone node. The node builds it from this
# file for each commit whose build inputs (.github/runner/build-inputs) changed, and boots one
# disposable VM from it per job.
FROM ghcr.io/actions/actions-runner:latest

USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential git jq \
    && rm -rf /var/lib/apt/lists/*

# Node and pnpm from mise.toml, installed system-wide so jobs start with them. rgbds is left out:
# CI never builds the disassembly.
COPY mise.toml /opt/baked-workspace/mise.toml
RUN export CI=true && \
    curl -fsSL https://mise.run | MISE_INSTALL_PATH=/usr/local/bin/mise sh && \
    cd /opt/baked-workspace && \
    mise trust && \
    mise install --system node pnpm && \
    chmod -R go-w /usr/local/share/mise

USER runner
