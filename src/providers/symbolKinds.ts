import * as vscode from 'vscode';
import { OutlineCategory } from '../language/outlineModel';

/**
 * 개요 분류(`language/outlineModel.OutlineCategory`) → VS Code `SymbolKind` 의 **단일 대응표**.
 * 개요(DocumentSymbol)와 워크스페이스 심볼(SymbolInformation)이 같은 표를 쓰므로 한 심볼이
 * 두 곳에서 다른 아이콘·필터 범주로 보이지 않는다(구조 테스트 R7 이 사본을 막는다).
 *
 * - `delegate` 는 `Class` 로 — GPL 문서가 Delegate 를 Class 선언과 동등하게 두고(§1-DU), LSP 에 Delegate 종류가 없다.
 * - `method`(클래스 멤버 Sub/Function)·`function`(모듈 프로시저)·`field`(멤버 변수) 구분은 `outline.show*`
 *   필터와 `Ctrl+Shift+O` 의 `@:` 묶음이 그 범주로 나뉘기 때문이다. 아이콘은 Method/Function 이 같다.
 */
const KIND_BY_CATEGORY: Readonly<Record<OutlineCategory, vscode.SymbolKind>> = {
    module: vscode.SymbolKind.Module,
    class: vscode.SymbolKind.Class,
    delegate: vscode.SymbolKind.Class,
    method: vscode.SymbolKind.Method,
    function: vscode.SymbolKind.Function,
    property: vscode.SymbolKind.Property,
    field: vscode.SymbolKind.Field,
    constant: vscode.SymbolKind.Constant,
    variable: vscode.SymbolKind.Variable,
};

export function toVsCodeSymbolKind(category: OutlineCategory): vscode.SymbolKind {
    return KIND_BY_CATEGORY[category] ?? vscode.SymbolKind.Variable;
}
