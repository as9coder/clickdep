const BucketViews = {
  async list(container) {
    const escapeHtml = (s) => {
      const d = document.createElement('div');
      d.textContent = s == null ? '' : String(s);
      return d.innerHTML;
    };

    container.innerHTML = `<div class="p-6 text-center text-muted">Loading Buckets...</div>`;

    let data = { files: [], stats: { count: 0, total_size: 0 } };
    let buckets = { buckets: [] };
    try {
      data = await API.get('/api/media');
    } catch (e) { /* empty */ }
    try {
      buckets = await API.get('/api/media/buckets');
    } catch (e) { /* empty */ }

    let selectedBucketId = '';

    const formatSize = (bytes) => {
      if (!bytes) return '0 B';
      const kb = bytes / 1024;
      if (kb < 1024) return `${Math.round(kb)} KB`;
      return `${(kb / 1024).toFixed(1)} MB`;
    };

    const isImage = (mime) => mime && mime.startsWith('image/');
    const isVideo = (mime) => mime && mime.startsWith('video/');

    const rawUrl = (embedUrl) => {
      const b = String(embedUrl || '').replace(/\/+$/, '');
      return `${b}/raw`;
    };

    const render = () => {
      const list = buckets.buckets || [];
      if (!selectedBucketId && list.length > 0) {
        selectedBucketId = list[0].id;
      }

      container.innerHTML = `
          <div class="page-header">
            <div>
                <h1>Buckets</h1>
                <span class="text-sm text-muted">${data.stats.count} files · ${formatSize(data.stats.total_size)} stored</span>
            </div>
          </div>

          <div class="settings-card" style="margin-bottom:24px">
            <div style="margin-bottom:16px">
                <h3 style="margin-bottom:4px">Create a bucket</h3>
                <span class="text-sm text-muted">A bucket is a folder. Name it, then select it to upload images, GIFs, videos, or any file. Links use your base domain (set in Settings).</span>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;max-width:520px">
                <div class="form-group" style="flex:1;min-width:180px;margin:0">
                    <input type="text" id="new-bucket-name" placeholder="e.g. screenshots" maxlength="64">
                </div>
                <button type="button" class="btn btn-primary btn-sm" id="btn-create-bucket" style="height:42px">Create bucket</button>
            </div>
          </div>

          <div class="settings-card" style="margin-bottom:24px">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:16px">
                <div>
                    <h3 style="margin-bottom:4px">Upload</h3>
                    <span class="text-sm text-muted">Choose a bucket, then add files. Share links embed on Discord, Slack, and similar apps (Open Graph). In a browser, images and videos open directly; other files get a simple viewer with download.</span>
                </div>
            </div>

            <div style="margin-bottom:16px">
                <label class="text-sm text-muted" style="display:block;margin-bottom:6px">Active bucket</label>
                <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
                    <div class="form-group" style="margin:0;min-width:220px;max-width:100%;flex:1">
                    <select id="bucket-select" style="width:100%">
                        <option value="">— Select a bucket —</option>
                        ${list.map((b) => `
                            <option value="${b.id}" ${b.id === selectedBucketId ? 'selected' : ''}>${escapeHtml(b.name)}</option>
                        `).join('')}
                    </select>
                    </div>
                    <button type="button" class="btn btn-ghost btn-sm" id="btn-delete-bucket" ${!selectedBucketId ? 'disabled' : ''} title="Only empty buckets">Delete bucket</button>
                </div>
            </div>

            <div id="upload-zone" style="border:2px dashed var(--border);border-radius:var(--radius);padding:40px 20px;text-align:center;cursor:pointer;transition:all 0.2s;background:var(--bg-body);margin-bottom:20px;${!selectedBucketId ? 'opacity:0.55;pointer-events:none' : ''}">
                <div style="font-size:32px;margin-bottom:8px">📤</div>
                <div style="font-weight:600;margin-bottom:4px">Drop files here or click to upload</div>
                <div class="text-sm text-muted">Images, GIFs, videos, or any file type · Max 500MB per file</div>
                <input type="file" id="file-input" multiple style="display:none">
            </div>

            <div id="upload-progress" style="display:none;margin-bottom:20px">
                <div style="display:flex;align-items:center;gap:12px">
                    <div style="flex:1;height:4px;background:var(--bg-input);border-radius:2px;overflow:hidden">
                        <div id="progress-bar" style="height:100%;width:0%;background:var(--primary);transition:width 0.3s;border-radius:2px"></div>
                    </div>
                    <span id="progress-text" class="text-sm text-muted">Uploading...</span>
                </div>
            </div>

            <p class="text-xs text-muted" style="margin:0">Link shape: <code class="mono">bucketname-filename-storage-xxxxx.yourdomain</code> (random id). Paste the share link in chat apps for rich embeds.</p>
          </div>

          <div class="settings-card">
            <h3 style="margin-bottom:16px">Your files</h3>
            ${data.files.length === 0 ? `
                <div style="text-align:center;padding:20px;opacity:0.6">
                    <p>No files yet. Create a bucket and upload above.</p>
                </div>
            ` : `
                <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(220px, 1fr));gap:16px">
                    ${data.files.map((f) => `
                        <div class="project-card" style="padding:0;overflow:hidden;position:relative" data-id="${f.id}">
                            <div style="height:140px;background:var(--bg-body);display:flex;align-items:center;justify-content:center;overflow:hidden">
                                ${isImage(f.mime_type)
        ? `<img src="${rawUrl(f.embed_url)}" style="width:100%;height:100%;object-fit:cover" loading="lazy" alt="">`
        : isVideo(f.mime_type)
          ? `<div style="font-size:48px;opacity:0.5">🎬</div>`
          : `<div style="font-size:48px;opacity:0.5">📄</div>`
}
                            </div>
                            <div style="padding:12px">
                                <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:2px">${escapeHtml(f.bucket_name || '—')}</div>
                                <div style="font-size:0.85rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:4px" title="${escapeHtml(f.original_name)}">${escapeHtml(f.original_name)}</div>
                                <div style="display:flex;align-items:center;justify-content:space-between">
                                    <span class="text-xs text-muted">${formatSize(f.file_size)}</span>
                                    <span class="text-xs text-muted">${timeAgo(f.created_at)}</span>
                                </div>
                                <div style="display:flex;gap:6px;margin-top:8px">
                                    <button class="btn btn-ghost copy-link-btn" style="flex:1;padding:4px 8px;font-size:0.75rem" data-url="${escapeHtml(f.embed_url)}">📋 Copy link</button>
                                    <button class="btn btn-ghost delete-media-btn" style="padding:4px 8px;font-size:0.75rem;color:var(--red)" data-id="${f.id}">🗑️</button>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `}
          </div>
        `;

      bindEvents();
    };

    const bindEvents = () => {
      const zone = container.querySelector('#upload-zone');
      const fileInput = container.querySelector('#file-input');
      const sel = container.querySelector('#bucket-select');

      sel?.addEventListener('change', () => {
        selectedBucketId = sel.value || '';
        const del = container.querySelector('#btn-delete-bucket');
        if (del) del.disabled = !selectedBucketId;
        const uz = container.querySelector('#upload-zone');
        if (uz) {
          if (selectedBucketId) {
            uz.style.opacity = '';
            uz.style.pointerEvents = '';
          } else {
            uz.style.opacity = '0.55';
            uz.style.pointerEvents = 'none';
          }
        }
      });

      container.querySelector('#btn-create-bucket')?.addEventListener('click', async () => {
        const inp = container.querySelector('#new-bucket-name');
        const name = (inp && inp.value && inp.value.trim()) || '';
        if (!name) {
          App.toast('Enter a bucket name', 'error');
          return;
        }
        try {
          await API.post('/api/media/buckets', { name });
          if (inp) inp.value = '';
          buckets = await API.get('/api/media/buckets');
          if (!selectedBucketId && buckets.buckets && buckets.buckets.length) {
            selectedBucketId = buckets.buckets[buckets.buckets.length - 1].id;
          }
          render();
          App.toast('Bucket created', 'success');
        } catch (err) {
          App.toast(err.message || 'Failed', 'error');
        }
      });

      container.querySelector('#btn-delete-bucket')?.addEventListener('click', async () => {
        if (!selectedBucketId) return;
        if (!confirm('Delete this bucket? It must be empty.')) return;
        try {
          await API.del(`/api/media/buckets/${selectedBucketId}`);
          selectedBucketId = '';
          buckets = await API.get('/api/media/buckets');
          data = await API.get('/api/media');
          render();
          App.toast('Bucket deleted', 'success');
        } catch (err) {
          App.toast(err.message || 'Failed', 'error');
        }
      });

      zone?.addEventListener('click', () => {
        if (!selectedBucketId) {
          App.toast('Select or create a bucket first', 'error');
          return;
        }
        fileInput.click();
      });

      fileInput?.addEventListener('change', (e) => {
        if (e.target.files.length > 0) uploadFiles(e.target.files);
        e.target.value = '';
      });

      zone?.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!selectedBucketId) return;
        zone.style.borderColor = 'var(--primary)';
        zone.style.background = 'rgba(108,92,231,0.05)';
      });

      zone?.addEventListener('dragleave', () => {
        zone.style.borderColor = 'var(--border)';
        zone.style.background = 'var(--bg-body)';
      });

      zone?.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.style.borderColor = 'var(--border)';
        zone.style.background = 'var(--bg-body)';
        if (!selectedBucketId) {
          App.toast('Select or create a bucket first', 'error');
          return;
        }
        if (e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files);
      });

      container.querySelectorAll('.copy-link-btn').forEach((btn) => {
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

      container.querySelectorAll('.delete-media-btn').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm('Delete this file permanently?')) return;
          try {
            await API.del(`/api/media/${btn.dataset.id}`);
            data = await API.get('/api/media');
            render();
            App.toast('File deleted', 'success');
          } catch (err) { App.toast(err.message, 'error'); }
        });
      });
    };

    const uploadFiles = async (fileList) => {
      if (!selectedBucketId) {
        App.toast('Select a bucket first', 'error');
        return;
      }

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

        const q = `bucketId=${encodeURIComponent(selectedBucketId)}`;

        try {
          const result = await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', `/api/media/upload?${q}`);

            if (API.token) xhr.setRequestHeader('Authorization', `Bearer ${API.token}`);

            xhr.upload.onprogress = (ev) => {
              if (ev.lengthComputable) {
                const pct = Math.round((ev.loaded / ev.total) * 100);
                progressBar.style.width = `${pct}%`;
              }
            };

            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                resolve(JSON.parse(xhr.responseText));
              } else {
                try { reject(new Error(JSON.parse(xhr.responseText).error)); }
                catch (e2) { reject(new Error(`Upload failed: ${xhr.status}`)); }
              }
            };

            xhr.onerror = () => reject(new Error('Network error'));
            xhr.send(formData);
          });

          if (result.embed_url) {
            await navigator.clipboard.writeText(result.embed_url).catch(() => {});
            App.toast(`Uploaded! Link copied: ${result.embed_url}`, 'success');
          }
        } catch (err) {
          App.toast(`Failed: ${err.message}`, 'error');
        }
      }

      progressDiv.style.display = 'none';

      try {
        data = await API.get('/api/media');
        render();
      } catch (e) { /* ignore */ }
    };

    render();
  },
};
