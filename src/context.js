import vscode from "vscode";
import { BaseComponent } from "./base-component";
import { registerCommand } from "./extension-register";
import { getLineInfoInDocument } from "./file";
import os from "os";

export const supportedLanguages = [
    "go",
    "python",
    // "typescript",
    // "javascript",
    // "java"
]

class EditLock {
    constructor() {
        this.isLocked = false;
    }

    tryWithLock(callback) {
        if (this.isLocked) return undefined;
        this.isLocked = true;
        try {
            return callback();
        } catch (err) {
            console.log(`Error occured when running in edit lock: \n${err}`);
            throw err;
        } finally {
            this.isLocked = false;
        }
    }

    async tryWithLockAsync(asyncCallback) {
        if (this.isLocked) return undefined;
        this.isLocked = true;
        try {
            return await asyncCallback();
        } catch (err) {
            console.log(`Error occured when running in edit lock (async): \n${err}`);
            throw err;
        } finally {
            this.isLocked = false;
        }
    }
}

export const globalEditLock = new EditLock();

class QueryState extends BaseComponent {
    constructor() {
        super();
        // request parameters
        this.commitMessage = "";

        // response parameters
        this.locations = [];
        this.locatedFilePaths = [];
        this._onDidQuery = new vscode.EventEmitter();
        this.onDidQuery = this._onDidQuery.event;

        this.register(
            registerCommand('editPilot.inputMessage', this.inputCommitMessage, this),
            this._onDidQuery
        );
    }

    async updateLocations(locations) {
        this.locations = locations;
        if (this.locations.length) {
            this.locatedFilePaths = [...new Set(locations.map((loc) => loc.targetFilePath))];
        }
        for (const loc of this.locations) {
            loc.lineInfo = await getLineInfoInDocument(loc.targetFilePath, loc.atLines[0]);
        }
        this._onDidQuery.fire(this);
    }

    async clearLocations() {
        this.updateLocations([]);
    }

    async requireCommitMessage() {
        if (!this.commitMessage) {
            this.commitMessage = await this.inputCommitMessage();
        }

        return this.commitMessage;
    }

    async inputCommitMessage() {
        console.log('==> Edit description input box is displayed');
        const userInput = await vscode.window.showInputBox({
            prompt: 'Enter a description of edits you want to make.',
            placeHolder: 'Add a feature...',
            ignoreFocusOut: true,
            value: queryState.commitMessage
        }) ?? "";
        console.log('==> Edit description:', userInput);
        this.commitMessage = userInput;

        return userInput;
    }
}

export const queryState = new QueryState();

class FileState extends BaseComponent {
    constructor() {
        super();
        this.prevCursorAtLine = 0;
        this.currCursorAtLine = 0;
        this.prevSnapshot = undefined;
        this.currSnapshot = undefined;
        this.prevEdits = [];
        this.inDiffEditor = false;
    }
}

export const fileState = new FileState();

export const supportedOSTypes = ['Windows_NT', 'Darwin', 'Linux'];
export const osType = os.type();

if (!supportedOSTypes.includes(osType)) {
    throw RangeError(`Operating system (node detected: ${osType}) is not supported yet.`);
}

export const defaultLineBreaks = {
    'Windows_NT': '\r\n',
    'Darwin': '\r',
    'Linux': '\n'
};
export const defaultLineBreak = defaultLineBreaks[osType] ?? '\n';

