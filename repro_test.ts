
import { describe, it, expect, beforeAll, afterAll } from "bun:test";

const API_URL = "http://localhost:3000/api";
const USER_ID = "test-user-123";
const PROJECT_NAME = "repro-persistence-test";
let projectId: string;

describe("File Persistence", () => {
    it("should create a test project", async () => {
        // cleanup if exists
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
            console.error(await res.text());
        }
        expect(res.status).toBe(201);
        const data = await res.json();
        projectId = data.id;
        console.log("Project created:", projectId);
    });

    it("should create a new file", async () => {
        const res = await fetch(`${API_URL}/projects/${projectId}/files`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-User-Id": USER_ID },
            body: JSON.stringify({ path: "test.txt", content: "Initial content" })
        });
        expect(res.status).toBe(200);
    });

    it("should read the file", async () => {
        const res = await fetch(`${API_URL}/projects/${projectId}/files/test.txt`, {
            headers: { "X-User-Id": USER_ID }
        });
        const data = await res.json();
        expect(data.content).toBe("Initial content");
    });

    it("should update the file via PUT", async () => {
        // Encode path exactly as frontend does now
        const encodedPath = "test.txt".split('/').map(s => encodeURIComponent(s)).join('/');

        const res = await fetch(`${API_URL}/projects/${projectId}/files/${encodedPath}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", "X-User-Id": USER_ID },
            body: JSON.stringify({ content: "Updated content" })
        });

        if (!res.ok) console.error(await res.text());
        expect(res.status).toBe(200);
    });

    it("should read the UPDATED file", async () => {
        const res = await fetch(`${API_URL}/projects/${projectId}/files/test.txt`, {
            headers: { "X-User-Id": USER_ID }
        });
        const data = await res.json();
        console.log("Read content:", data.content);
        expect(data.content).toBe("Updated content");
    });
});
