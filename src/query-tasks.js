import vscode from 'vscode';
import { getRootPath, getGlobFiles, updatePrevEdits, getLocationAtRange, toPosixPath, globalEditDetector } from './file';
import { fileState, queryState } from './context';
import { queryLocationFromModel, queryEditFromModel } from './queries';
import { BaseComponent } from './base-component';
import { EditSelector, diffTabSelectors, tempWrite } from './compare-view';
import { registerCommand } from './extension-register';
import { supportedLanguages } from './context';
import { globalEditLock } from './context';

async function predictLocation() {
    const language = vscode.window.activeTextEditor?.document?.languageId.toLowerCase();
    if (!supportedLanguages.includes(language)) {
        vscode.window.showInformationMessage(`Predicting location canceled: language ${language} not supported yet.`)
        return;
    }
    return await globalEditLock.tryWithLockAsync(async () => {
        const commitMessage = await queryState.requireCommitMessage();
        const rootPath = getRootPath();
        const files = await getGlobFiles();
        // const currentPrevEdits = getPrevEdits();
        try {
            const currentPrevEdits = await globalEditDetector.getUpdatedEditList();
            await queryLocationFromModel(rootPath, files, currentPrevEdits, commitMessage, language);
        } catch (err) {
            console.log(err);
        }
    });
}

async function predictLocationIfHasEditAtSelectedLine(event) {
    const hasNewEdits = updatePrevEdits(event.selections[0].active.line);
    if (hasNewEdits) {
        await predictLocation();
    }
}

async function predictEdit(document, location) {
    return await globalEditLock.tryWithLockAsync(async () => {
        const predictResult = await queryEditFromModel(
            document.getText(),
            location.editType,
            location.atLines,
            fileState.prevEdits,
            queryState.commitMessage
        );
        const replacedRange = new vscode.Range(document.positionAt(location.startPos), document.positionAt(location.endPos));
        const replacedContent = document.getText(replacedRange).trim();
        predictResult.replacement = predictResult.replacement.filter((snippet) => snippet.trim() !== replacedContent);
        return predictResult;
    });
}

async function predictEditAtRange(document, range) {
    const targetLocation = getLocationAtRange(queryState.locations, document, range);    
    if (targetLocation) {
        return predictEdit(document, targetLocation)
    } 
    return undefined;
}

class PredictLocationCommand extends BaseComponent{
	constructor() {
		super();
		this.register(
			vscode.commands.registerCommand("editPilot.predictLocations", () => { predictLocation(); })
		);
	}
}

class GenerateEditCommand extends BaseComponent{
	constructor() {
		super();
        this.register(
            this.registerEditSelectionCommands(),
            vscode.commands.registerCommand("editPilot.generateEdits", async (...args) => {
                const language = vscode.window.activeTextEditor?.document?.languageId.toLowerCase();
                if (!supportedLanguages.includes(language)) {
                    vscode.window.showInformationMessage(`Predicting edit canceled: language ${language} not supported yet.`)
                    return;
                }
            
				if (args.length != 1 || !(args[0] instanceof vscode.Uri)) return;
				
				const uri = args[0];
				const activeEditor = vscode.window.activeTextEditor;
				const activeDocument = activeEditor.document;
				if (activeDocument.uri.toString() !== uri.toString()) return;
                const atLines = [];
                const selectedRange = activeEditor.selection;
                
                const fromLine = selectedRange.start.line;
                let toLine = selectedRange.end.line;
                let editType = "";
                if (selectedRange.isEmpty) {
                    editType = "add";
                    atLines.push(fromLine);
                } else {
                    editType = "replace";
                    // If only the beginning of the last line is included, exclude the last line
                    if (selectedRange.end.character === 0) {
                        toLine -= 1;
                    }
                    for (let i = fromLine; i <= toLine; ++i) {
                        atLines.push(i);
                    }
                }
                
                const targetFileContent = activeDocument.getText();
                const selectedContent = activeDocument.getText(
                    new vscode.Range(
                        activeDocument.lineAt(fromLine).range.start,
                        activeDocument.lineAt(toLine).range.end
                    )
                );
                
                const commitMessage = await queryState.requireCommitMessage();
                const queryResult = await queryEditFromModel(
                    targetFileContent,
                    editType,
                    atLines,
                    await globalEditDetector.getUpdatedEditList(),
                    commitMessage,
                    language
                );
                
                // Remove syntax-level unchanged replacements
				queryResult.replacement = queryResult.replacement.filter((snippet) => snippet.trim() !== selectedContent.trim());
		
				try {
					const selector = new EditSelector(
						toPosixPath(uri.fsPath),
						fromLine,
						toLine+1,
                        queryResult.replacement,
                        tempWrite,
                        editType == "add"
					);
					await selector.init();
					await selector.editedDocumentAndShowDiff();
				} catch (err) {
					console.log(err);
				}
			})
		);
    }
    
    registerEditSelectionCommands() {
        function getSelectorOfCurrentTab() {
            const currTab = vscode.window.tabGroups.activeTabGroup.activeTab;
            const selector = diffTabSelectors[currTab];
            return selector;
        }
        function switchEdit(offset) {
            const selector = getSelectorOfCurrentTab();
            selector && selector.switchEdit(offset);
        }
        function clearEdit() {
            const selector = getSelectorOfCurrentTab();
            selector && selector.clearEdit();
        }
        function closeTab() {
            const tabGroups = vscode.window.tabGroups;
            tabGroups.close(tabGroups.activeTabGroup.activeTab, true);
        }
        return vscode.Disposable.from(
            registerCommand("editPilot.last-suggestion", () => {
                switchEdit(-1);
            }),
            registerCommand("editPilot.next-suggestion", () => {
                switchEdit(1);
            }),
            registerCommand("editPilot.accept-edit", () => {
                closeTab();
            }),
            registerCommand("editPilot.dismiss-edit", () => {
                clearEdit();
                closeTab();
            })
        )
    }
}

export {
    predictLocation,
    predictLocationIfHasEditAtSelectedLine,
    predictEdit,
    predictEditAtRange,
    PredictLocationCommand,
    GenerateEditCommand
};
