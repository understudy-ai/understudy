import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createPdfTool } from "../pdf-tool.js";

const SAMPLE_PDF = `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length 33 >>\nstream\nBT\n(Hello PDF) Tj\nET\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`;

describe("createPdfTool", () => {
	it("inspects PDF metadata", async () => {
		const dir = await mkdtemp(join(tmpdir(), "understudy-pdf-test-"));
		const pdfPath = join(dir, "sample.pdf");
		await writeFile(pdfPath, SAMPLE_PDF, "latin1");

		const tool = createPdfTool();
		const result = await tool.execute("id", { action: "inspect", pdf: pdfPath });
		const text = (result.content[0] as any).text as string;

		expect(text).toContain("PDF:");
		expect(text).toContain("Estimated Pages: 1");
		expect((result.details as any).pages).toBe(1);
	});

	it("extracts text literals from PDF stream", async () => {
		const dir = await mkdtemp(join(tmpdir(), "understudy-pdf-test-"));
		const pdfPath = join(dir, "sample.pdf");
		await writeFile(pdfPath, SAMPLE_PDF, "latin1");

		const tool = createPdfTool();
		const result = await tool.execute("id", { action: "extract", pdf: pdfPath });
		const text = (result.content[0] as any).text as string;

		expect(text).toContain("Hello PDF");
		expect((result.details as any).extractedChars).toBeGreaterThan(0);
	});

	it("returns clear error for non-pdf input", async () => {
		const dir = await mkdtemp(join(tmpdir(), "understudy-pdf-test-"));
		const textPath = join(dir, "notpdf.txt");
		await writeFile(textPath, "hello", "utf8");

		const tool = createPdfTool();
		const result = await tool.execute("id", { action: "inspect", pdf: textPath });
		expect((result.content[0] as any).text).toContain("Input is not a PDF");
	});
});
