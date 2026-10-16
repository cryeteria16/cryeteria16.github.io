// 1. Photo Counting Logic
const photoInput = document.getElementById('photo-input');
const photoCountTxt = document.getElementById('photo-preview-count');
let selectedFiles = [];

photoInput.addEventListener('change', (e) => {
    selectedFiles = Array.from(e.target.files);
    if (selectedFiles.length > 0) {
        photoCountTxt.textContent = `${selectedFiles.length} photo(s) selected ready for grid alignment.`;
    }
});

// 2. Gemini AI Auto-Fill Engine
document.getElementById('btn-ai-fill').addEventListener('click', async () => {
    const btnText = document.getElementById('ai-btn-text');
    const spinner = document.getElementById('ai-spin');
    const promptInput = document.getElementById('ai-prompt').value;

    if (!promptInput.trim()) {
        alert("Please type a rough summary of the breakdown first.");
        return;
    }

    btnText.textContent = "Connecting to Gemini Engine...";
    spinner.style.display = "inline-block";

    try {
        const response = await fetch('https://vault.ibadhasan.com/api/showcase/ai-draft', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: promptInput })
        });

        if (!response.ok) throw new Error('AI Engine failed');
        const data = await response.json();

        document.getElementById('rep-title').value = data.title || '';
        document.getElementById('rep-loc').value = data.location || '';
        document.getElementById('rep-desc').value = data.description || '';
        document.getElementById('rep-cause').value = data.cause || '';
        document.getElementById('rep-containment').value = data.containment || '';
        document.getElementById('rep-scope').value = data.scope || '';

        btnText.textContent = "Report Drafted Successfully!";
    } catch (err) {
        btnText.textContent = "Error Generating Draft";
    } finally {
        spinner.style.display = "none";
        setTimeout(() => btnText.textContent = "Auto-Fill Corporate Report via Gemini", 3000);
    }
});

// 3. Document Compilation & Export
document.getElementById('btn-generate').addEventListener('click', async () => {
    const btn = document.getElementById('btn-generate');
    const btnText = document.getElementById('gen-btn-text');
    const spinner = document.getElementById('gen-spin');

    btn.style.background = "var(--con)";
    btn.style.color = "#000";
    btnText.textContent = "Compiling & Converting to PDF...";
    spinner.style.display = "inline-block";
    btn.disabled = true;

    const formData = new FormData();
    formData.append('title', document.getElementById('rep-title').value);
    formData.append('location', document.getElementById('rep-loc').value);
    formData.append('description', document.getElementById('rep-desc').value);
    formData.append('cause', document.getElementById('rep-cause').value);
    formData.append('containment', document.getElementById('rep-containment').value);
    formData.append('scope', document.getElementById('rep-scope').value);

    // Append all selected photos
    selectedFiles.forEach(file => formData.append('photos', file));

    try {
        const response = await fetch('https://vault.ibadhasan.com/api/showcase/generate-breakdown', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) throw new Error('Generation failed');

        // Force browser to download the returning PDF
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `AGFS_Breakdown_Report_${Date.now()}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);

        btnText.textContent = "PDF Downloaded!";
    } catch (err) {
        btnText.textContent = "Error Generating PDF";
        btn.style.background = "var(--err)";
    } finally {
        spinner.style.display = "none";
        setTimeout(() => { 
            btn.disabled = false; 
            btnText.textContent = "Generate Official PDF"; 
            btn.style.background = "var(--ink)";
            btn.style.color = "#000";
        }, 3000);
    }
});
