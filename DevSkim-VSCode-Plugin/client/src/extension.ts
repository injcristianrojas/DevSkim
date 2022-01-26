/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as path from 'path';
import { workspace, ExtensionContext } from 'vscode';
import { CodeFix, CodeFixMapping } from './codeFixMapping';
import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from 'vscode-languageclient/node';

import * as vscode from 'vscode';

let client: LanguageClient;

const selectors = [{ scheme: 'file', language: 'c' },
{ scheme: 'file', language: 'clojure' },
{ scheme: 'file', language: 'coffeescript' },
{ scheme: 'file', language: 'cpp' },
{ scheme: 'file', language: 'csharp' },
{ scheme: 'file', language: 'fsharp' },
{ scheme: 'file', language: 'go' },
{ scheme: 'file', language: 'groovy' },
{ scheme: 'file', language: 'jade' },
{ scheme: 'file', language: 'java' },
{ scheme: 'file', language: 'javascript' },
{ scheme: 'file', language: 'javascriptreact' },
{ scheme: 'file', language: 'lua' },
{ scheme: 'file', language: 'objective-c' },
{ scheme: 'file', language: 'perl' },
{ scheme: 'file', language: 'perl6' },
{ scheme: 'file', language: 'php' },
{ scheme: 'file', language: 'plaintext' },
{ scheme: 'file', language: 'powershell' },
{ scheme: 'file', language: 'python' },
{ scheme: 'file', language: 'r' },
{ scheme: 'file', language: 'ruby' },
{ scheme: 'file', language: 'rust' },
{ scheme: 'file', language: 'shellscript' },
{ scheme: 'file', language: 'sql' },
{ scheme: 'file', language: 'swift' },
{ scheme: 'file', language: 'typescript' },
{ scheme: 'file', language: 'typescriptreact' },
{ scheme: 'file', language: 'vb' },
{ scheme: 'file', language: 'xml' },
{ scheme: 'file', language: 'yaml' }];

async function resolveDotNetPath(): Promise<string> {
	const result = await vscode.commands.executeCommand<any>(
		"dotnet.acquire",
		{
			version: "6.0",
			requestingExtensionId: "lsp-sample",
		}
	);
	return result?.dotnetPath;
}

export class DevSkimFixer implements vscode.CodeActionProvider {

	public static readonly providedCodeActionKinds = [
		vscode.CodeActionKind.QuickFix
	];

	provideCodeActions(document: vscode.TextDocument, range: vscode.Range | vscode.Selection, context: vscode.CodeActionContext, token: vscode.CancellationToken): vscode.CodeAction[] {
		// for each diagnostic entry that has the matching `code`, create a code action command
		const output : vscode.CodeAction[] = [];
		context.diagnostics.filter(diagnostic => diagnostic.code === "MS-CST-E.vscode-devskim").forEach((filtered : vscode.Diagnostic) => 
			fixMapping.get(createMapKeyForDiagnostic(filtered, document.uri.toString())).forEach(codeFix => {
				output.push(this.createFix(document, range, codeFix));
			})
		);
		return output;
	}

	private createFix(document: vscode.TextDocument, range: vscode.Range, codeFix: CodeFix): vscode.CodeAction {
		const fix = new vscode.CodeAction(codeFix.name, vscode.CodeActionKind.QuickFix);
		fix.edit = new vscode.WorkspaceEdit();
		fix.edit.replace(document.uri, range, codeFix.replacement);
		return fix;
	}
}

export function activate(context: ExtensionContext) {
	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider(selectors, new DevSkimFixer(), {
			providedCodeActionKinds: DevSkimFixer.providedCodeActionKinds
		})
	);
	// The server bridge is implemented in node
	const serverModule = context.asAbsolutePath(
		path.join('server', 'out', 'server.js')
	);
	// The debug options for the server
	// --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
	resolveDotNetPath().then((dotNetPath) =>
	{
		if (dotNetPath == undefined || dotNetPath == null)
		{
			// Error Can't start Extension
		}
		else
		{
			const debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };
			// If the extension is launched in debug mode then the debug server options are used
			// Otherwise the run options are used
			const serverOptions: ServerOptions = {
				run: { module: serverModule, transport: TransportKind.ipc },
				debug: {
					module: serverModule,
					transport: TransportKind.ipc,
					options: debugOptions
				}
			};
	
			// Options to control the language client
			const clientOptions: LanguageClientOptions = {
				// Register the server for plain text documents
				documentSelector: selectors,
				synchronize: {
					// Notify the server about file changes to '.clientrc files contained in the workspace
					fileEvents: workspace.createFileSystemWatcher('**/.clientrc')
				}
			};
	
			// Create the language client and start the client.
			client = new LanguageClient(
				'MS-CST-E.vscode-devskim',
				'DevSkim VS Code Client',
				serverOptions,
				clientOptions
			);
			client.onReady().then(() => {
				client.sendNotification("dotnetPath",dotNetPath);
				const devskimExtension = vscode.extensions.getExtension('MS-CST-E.vscode-devskim');
				if (!devskimExtension) {
					throw new Error('Could not find DevSkim extension.');
				}
				client.sendNotification("devskimPath",path.join(devskimExtension.extensionPath, 'devskimBinaries', 'devskim.dll'));
				client.onNotification("addCodeFixMapping", (mapping: CodeFixMapping) => 
				{
					ensureMapHasMapping(mapping);
				});
			});
			// Start the client. This will also launch the server
			client.start();
		}
	});
}

function createMapKeyForDiagnostic(diagnostic: vscode.Diagnostic, fileName: string) : string
{
	return `${fileName}: ${diagnostic.message}, ${diagnostic.code.valueOf()}, ${diagnostic.range.start.line}, ${diagnostic.range.start.character}, ${diagnostic.range.end.line}, ${diagnostic.range.end.character}`;
}

function ensureMapHasMapping(mapping: CodeFixMapping)
{
	const key = createMapKeyForDiagnostic(mapping.diagnostic, mapping.fileName);
	if(fixMapping.has(key))
	{
		if (!fixMapping.get(key).find(x => x.name == mapping.replacement.name && x.replacement == mapping.replacement.replacement && x.type == mapping.replacement.type))
		{
			fixMapping.set(key, fixMapping.get(key).concat(mapping.replacement));
		}
	}
	else
	{
		fixMapping.set(key, [mapping.replacement]);
	}
}

const fixMapping = new Map<string, CodeFix[]>();

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}
