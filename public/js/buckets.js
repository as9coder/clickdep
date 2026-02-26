const BucketViews = {
    // ─── MAIN VIEW ──────────────────────────────
    async list(container) {
        container.innerHTML = `<div class="p-6 text-center text-muted">Loading Buckets...</div>`;

        let data = { files: [], stats: { count: 0, total_size: 0 } };
        try {
            data = await API.get('/api/media');
        } catch (e) { }

        const formatSize = (bytes) => {
            if (!bytes) return '0 B';
            const kb = bytes / 1024;
            if (kb < 1024) return `${Math.round(kb)} KB`;
            return `${(kb / 1024).toFixed(1)} MB`;
        };

        const isImage = (mime) => mime && mime.startsWith('image/');
        const isVideo = (mime) => mime && mime.startsWith('video/');

        const render = () => {
            container.innerHTML = `
          <div class="page-header">
            <div>
                <h1>Buckets</h1>
                <span class="text-sm text-muted">${data.stats.count} files · ${formatSize(data.stats.total_size)} used</span>
            </div>
          </div>

          <!-- EMBED BUCKET -->
          <div class="settings-card" style="margin-bottom:24px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
                <div>
                    <h3 style="margin-bottom:4px">📎 Embed Bucket</h3>
                    <span class="text-sm text-muted">Upload images, videos & GIFs. Get instant embeddable links for Discord, Slack & Twitter.</span>
                </div>
            </div>

            <!-- UPLOAD ZONE -->
            <div id="upload-zone" style="border:2px dashed var(--border);border-radius:var(--radius);padding:40px 20px;text-align:center;cursor:pointer;transition:all 0.2s;background:var(--bg-body);margin-bottom:20px">
                <div style="font-size:32px;margin-bottom:8px">📤</div>
                <div style="font-weight:600;margin-bottom:4px">Drop files here or click to upload</div>
                <div class="text-sm text-muted">PNG, JPG, GIF, WEBP, MP4, WEBM · Max 100MB</div>
                <input type="file" id="file-input" accept="image/*,video/*,.gif" multiple style="display:none">
            </div>

            <!-- UPLOAD PROGRESS -->
            <div id="upload-progress" style="display:none;margin-bottom:20px">
                <div style="display:flex;align-items:center;gap:12px">
                    <div style="flex:1;height:4px;background:var(--bg-input);border-radius:2px;overflow:hidden">
                        <div id="progress-bar" style="height:100%;width:0%;background:var(--primary);transition:width 0.3s;border-radius:2px"></div>
                    </div>
                    <span id="progress-text" class="text-sm text-muted">Uploading...</span>
                </div>
            </div>

            <!-- FILE GRID -->
            ${data.files.length === 0 ? `
                <div style="text-align:center;padding:20px;opacity:0.5">
                    <p>No files uploaded yet. Drop something above!</p>
                </div>
            ` : `
                <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(220px, 1fr));gap:16px">
                    ${data.files.map(f => `
                        <div class="project-card" style="padding:0;overflow:hidden;position:relative" data-id="${f.id}">
                            <div style="height:140px;background:var(--bg-body);display:flex;align-items:center;justify-content:center;overflow:hidden">
                                ${isImage(f.mime_type)
                    ? `<img src="${f.embed_url}/raw" style="width:100%;height:100%;object-fit:cover" loading="lazy">`
                    : isVideo(f.mime_type)
                        ? `<div style="font-size:48px;opacity:0.5">🎬</div>`
                        : `<div style="font-size:48px;opacity:0.5">📄</div>`
                }
                            </div>
                            <div style="padding:12px">
                                <div style="font-size:0.85rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:4px" title="${f.original_name}">${f.original_name}</div>
                                <div style="display:flex;align-items:center;justify-content:space-between">
                                    <span class="text-xs text-muted">${formatSize(f.file_size)}</span>
                                    <span class="text-xs text-muted">${App.timeAgo(f.created_at)}</span>
                                </div>
                                <div style="display:flex;gap:6px;margin-top:8px">
                                    <button class="btn btn-ghost copy-link-btn" style="flex:1;padding:4px 8px;font-size:0.75rem" data-url="${f.embed_url}">📋 Copy Link</button>
                                    <button class="btn btn-ghost delete-media-btn" style="padding:4px 8px;font-size:0.75rem;color:var(--red)" data-id="${f.id}">🗑️</button>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `}
          </div>

          <!-- STORAGE BUCKET (Coming Soon) -->
          <div class="settings-card" style="opacity:0.6">
            <div style="display:flex;align-items:center;gap:12px">
                <h3 style="margin-bottom:0">🗄️ Storage Buckets</h3>
                <span class="badge" style="background:var(--primary);color:white;font-size:0.7rem">Coming Soon</span>
            </div>
            <p class="text-sm text-muted" style="margin-top:8px">
                S3-compatible object storage powered by MinIO. Create private or public buckets, manage access keys, and use standard AWS SDKs to integrate with your apps.
            </p>
          </div>
        `;

            bindEvents();
        };

        const bindEvents = () => {
            const zone = container.querySelector('#upload-zone');
            const fileInput = container.querySelector('#file-input');

            // Click to upload
            zone.addEventListener('click', () => fileInput.click());

            // File selected
            fileInput.addEventListener('change', (e) => {
                if (e.target.files.length > 0) uploadFiles(e.target.files);
            });

            // Drag and drop
            zone.addEventListener('dragover', (e) => {
                e.preventDefault();
                zone.style.borderColor = 'var(--primary)';
                zone.style.background = 'rgba(108,92,231,0.05)';
            });

            zone.addEventListener('dragleave', () => {
                zone.style.borderColor = 'var(--border)';
                zone.style.background = 'var(--bg-body)';
            });

            zone.addEventListener('drop', (e) => {
                e.preventDefault();
                zone.style.borderColor = 'var(--border)';
                zone.style.background = 'var(--bg-body)';
                if (e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files);
            });

            // Copy link buttons
            container.querySelectorAll('.copy-link-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const url = btn.dataset.url;
                    navigator.clipboard.writeText(url).then(() => {
                        const orig = btn.textContent;
                        btn.textContent = '✅ Copied!';
                        setTimeout(() => { btn.textContent = orig; }, 1500);
                    });
                });
            });

            // Delete buttons
            container.querySelectorAll('.delete-media-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (!confirm('Delete this file permanently?')) return;
                    try {
                        await API.del(`/api/media/${btn.dataset.id}`);
                        // Refresh
                        data = await API.get('/api/media');
                        render();
                        App.toast('File deleted', 'success');
                    } catch (err) { App.toast(err.message, 'error'); }
                });
            });
        };

        const uploadFiles = async (fileList) => {
            const progressDiv = container.querySelector('#upload-progress');
            const progressBar = container.querySelector('#progress-bar');
            const progressText = container.querySelector('#progress-text');
            progressDiv.style.display = 'block';

            for (let i = 0; i < fileList.length; i++) {
                const file = fileList[i];
                progressText.textContent = `Uploading ${file.name} (${i + 1}/${fileList.length})...`;
                progressBar.style.width = '0%';

                const formData = new FormData();
                formData.append('file', file);

                try {
                    const result = await new Promise((resolve, reject) => {
                        const xhr = new XMLHttpRequest();
                        xhr.open('POST', '/api/media/upload');

                        // Auth header
                        if (API.token) xhr.setRequestHeader('Authorization', `Bearer ${API.token}`);

                        xhr.upload.onprogress = (e) => {
                            if (e.lengthComputable) {
                                const pct = Math.round((e.loaded / e.total) * 100);
                                progressBar.style.width = pct + '%';
                            }
                        };

                        xhr.onload = () => {
                            if (xhr.status >= 200 && xhr.status < 300) {
                                resolve(JSON.parse(xhr.responseText));
                            } else {
                                try { reject(new Error(JSON.parse(xhr.responseText).error)); }
                                catch (e) { reject(new Error(`Upload failed: ${xhr.status}`)); }
                            }
                        };

                        xhr.onerror = () => reject(new Error('Network error'));
                        xhr.send(formData);
                    });

                    // Copy the link to clipboard automatically
                    if (result.embed_url) {
                        await navigator.clipboard.writeText(result.embed_url).catch(() => { });
                        App.toast(`Uploaded! Link copied: ${result.embed_url}`, 'success');
                    }
                } catch (err) {
                    App.toast(`Failed: ${err.message}`, 'error');
                }
            }

            progressDiv.style.display = 'none';

            // Refresh the file list
            try {
                data = await API.get('/api/media');
                render();
            } catch (e) { }
        };

        render();
    }
};
