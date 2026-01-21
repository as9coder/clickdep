
const API_URL = "http://127.0.0.1:3000/api";
const USER_ID = "test-user-123";
const PROJECT_NAME = "repro-persistence-script";
let projectId: string;

async function run() {
    console.log("1. Creating project...");

    // cleanup
    try {
        const list = await fetch(`${API_URL}/projects`, { headers: { "X-User-Id": USER_ID } }).then(r => r.json());
        const existing = list.find((p: any) => p.name === PROJECT_NAME);
        if (existing) {
            await fetch(`${API_URL}/projects/${existing.id}`, { method: "DELETE" });
        }
    } catch (e) { }

    const res = await fetch(`${API_URL}/projects/template`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-User-Id": USER_ID
        },
        body: JSON.stringify({ name: PROJECT_NAME, template: "html5" })
    });

    if (!res.ok) {
        console.error("Create failed:", await res.text());
        return;
    }
    const data = await res.json();
    projectId = data.id;
    console.log("   Project created:", projectId);

    console.log("2. Creating file test.txt...");
    const res2 = await fetch(`${API_URL}/projects/${projectId}/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-User-Id": USER_ID },
        body: JSON.stringify({ path: "test.txt", content: "Initial content" })
    });
    console.log("   Create file status:", res2.status);

    console.log("3. Reading file...");
    const res3 = await fetch(`${API_URL}/projects/${projectId}/files/test.txt?t=${Date.now()}`, {
        headers: { "X-User-Id": USER_ID }
    });
    const data3 = await res3.json();
    console.log("   Content:", data3.content);
    if (data3.content !== "Initial content") console.error("   MISMATCH!");

    console.log("4. Updating file test.txt (PUT)...");
    const encodedPath = "test.txt".split('/').map(s => encodeURIComponent(s)).join('/');
    const res4 = await fetch(`${API_URL}/projects/${projectId}/files/${encodedPath}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-User-Id": USER_ID },
        body: JSON.stringify({ content: "Updated content" })
    });

    if (!res4.ok) console.error("   Update updated failed:", await res4.text());
    console.log("   Update status:", res4.status);

    console.log("5. Reading file AGAIN...");
    const res5 = await fetch(`${API_URL}/projects/${projectId}/files/test.txt?t=${Date.now()}`, {
        headers: { "X-User-Id": USER_ID }
    });
    const data5 = await res5.json();
    console.log("   Content:", data5.content);

    if (data5.content === "Updated content") {
        console.log("✅ SUCCESS: Content persisted.");
    } else {
        console.error("❌ FAILURE: Content did NOT persist. Expected 'Updated content', got '" + data5.content + "'");
    }
}

run();
