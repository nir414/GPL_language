import { ciEq } from './config';

export type GPLBuiltinKind = 'function' | 'method' | 'property';

export interface GPLBuiltinEntry {
    name: string;
    kind: GPLBuiltinKind;
    signature: string;
    summary: string;
    category: string;
    insertSnippet?: string;
    sourceUrl?: string;
}

export const GPL_DICTIONARY_ROOT_URL = 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/';

const GPL_BUILTINS: GPLBuiltinEntry[] = [
    // Functions
    {
        name: 'CBool',
        kind: 'function',
        signature: 'CBool(value)',
        summary: '값을 Boolean으로 변환합니다.',
        category: 'Functions',
        insertSnippet: 'CBool(${1:value})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Function_Dictionary/cbool.htm'
    },
    {
        name: 'CByte',
        kind: 'function',
        signature: 'CByte(value)',
        summary: '값을 Byte로 변환합니다.',
        category: 'Functions',
        insertSnippet: 'CByte(${1:value})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Function_Dictionary/cbyte.htm'
    },
    {
        name: 'CShort',
        kind: 'function',
        signature: 'CShort(value)',
        summary: '값을 Short(Integer16)로 변환합니다.',
        category: 'Functions',
        insertSnippet: 'CShort(${1:value})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Function_Dictionary/cshort.htm'
    },
    {
        name: 'CInt',
        kind: 'function',
        signature: 'CInt(value)',
        summary: '값을 Integer(Int32)로 변환합니다.',
        category: 'Functions',
        insertSnippet: 'CInt(${1:value})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Function_Dictionary/cint.htm'
    },
    {
        name: 'CSng',
        kind: 'function',
        signature: 'CSng(value)',
        summary: '값을 Single로 변환합니다.',
        category: 'Functions',
        insertSnippet: 'CSng(${1:value})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Function_Dictionary/csng.htm'
    },
    {
        name: 'CDbl',
        kind: 'function',
        signature: 'CDbl(value)',
        summary: '값을 Double로 변환합니다.',
        category: 'Functions',
        insertSnippet: 'CDbl(${1:value})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Function_Dictionary/cdbl.htm'
    },
    {
        name: 'CStr',
        kind: 'function',
        signature: 'CStr(value)',
        summary: '값을 String으로 변환합니다.',
        category: 'Functions',
        insertSnippet: 'CStr(${1:value})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Function_Dictionary/cstr.htm'
    },
    {
        name: 'Fix',
        kind: 'function',
        signature: 'Fix(number)',
        summary: '소수점 이하를 제거한 정수부를 반환합니다.',
        category: 'Functions',
        insertSnippet: 'Fix(${1:number})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Function_Dictionary/fix.htm'
    },
    {
        name: 'Hex',
        kind: 'function',
        signature: 'Hex(number)',
        summary: '숫자를 16진수 문자열로 변환합니다.',
        category: 'Functions',
        insertSnippet: 'Hex(${1:number})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Function_Dictionary/hex.htm'
    },
    {
        name: 'Int',
        kind: 'function',
        signature: 'Int(number)',
        summary: '숫자를 내림한 정수값으로 반환합니다.',
        category: 'Functions',
        insertSnippet: 'Int(${1:number})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Function_Dictionary/int.htm'
    },
    {
        name: 'Rnd',
        kind: 'function',
        signature: 'Rnd()',
        summary: '0.0 이상 1.0 미만 난수를 반환합니다.',
        category: 'Functions',
        insertSnippet: 'Rnd()',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Function_Dictionary/rnd.htm'
    },

    // String helpers (commonly used in GPL source)
    {
        name: 'Mid',
        kind: 'function',
        signature: 'Mid(string, start, length)',
        summary: '문자열의 부분 문자열을 추출합니다.',
        category: 'String',
        insertSnippet: 'Mid(${1:string}, ${2:start}, ${3:length})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/String/mid.htm'
    },
    {
        name: 'InStr',
        kind: 'function',
        signature: 'InStr(start, string, searchString)',
        summary: '문자열에서 검색 문자열의 위치를 찾습니다.',
        category: 'String',
        insertSnippet: 'InStr(${1:start}, ${2:string}, ${3:searchString})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/String/instr.htm'
    },
    {
        name: 'Len',
        kind: 'function',
        signature: 'Len(string)',
        summary: '문자열 길이를 반환합니다.',
        category: 'String',
        insertSnippet: 'Len(${1:string})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/String/len.htm'
    },
    {
        name: 'Trim',
        kind: 'function',
        signature: 'Trim(string)',
        summary: '문자열 양끝 공백을 제거합니다.',
        category: 'String',
        insertSnippet: 'Trim(${1:string})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/String/trim.htm'
    },
    {
        name: 'Replace',
        kind: 'function',
        signature: 'Replace(string, find, replacement)',
        summary: '문자열의 일부를 다른 문자열로 치환합니다.',
        category: 'String',
        insertSnippet: 'Replace(${1:string}, ${2:find}, ${3:replacement})',

    },

    // Math Class
    {
        name: 'Math.Abs',
        kind: 'method',
        signature: 'Math.Abs(expression)',
        summary: '절대값을 반환합니다.',
        category: 'Math Class',
        insertSnippet: 'Math.Abs(${1:expression})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Math/abs.htm'
    },
    {
        name: 'Math.Acos',
        kind: 'method',
        signature: 'Math.Acos(expression)',
        summary: '아크코사인 값을 반환합니다.',
        category: 'Math Class',
        insertSnippet: 'Math.Acos(${1:expression})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Math/acos.htm'
    },
    {
        name: 'Math.Asin',
        kind: 'method',
        signature: 'Math.Asin(expression)',
        summary: '아크사인 값을 반환합니다.',
        category: 'Math Class',
        insertSnippet: 'Math.Asin(${1:expression})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Math/asin.htm'
    },
    {
        name: 'Math.Atan',
        kind: 'method',
        signature: 'Math.Atan(expression)',
        summary: '아크탄젠트 값을 반환합니다.',
        category: 'Math Class',
        insertSnippet: 'Math.Atan(${1:expression})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Math/atan.htm'
    },
    {
        name: 'Math.Atan2',
        kind: 'method',
        signature: 'Math.Atan2(y, x)',
        summary: '좌표의 사분면을 고려한 아크탄젠트를 반환합니다.',
        category: 'Math Class',
        insertSnippet: 'Math.Atan2(${1:y}, ${2:x})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Math/atan2.htm'
    },
    {
        name: 'Math.Ceiling',
        kind: 'method',
        signature: 'Math.Ceiling(expression)',
        summary: '천장값(올림 정수)을 반환합니다.',
        category: 'Math Class',
        insertSnippet: 'Math.Ceiling(${1:expression})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Math/ceiling.htm'
    },
    {
        name: 'Math.Cos',
        kind: 'method',
        signature: 'Math.Cos(expression)',
        summary: '코사인 값을 반환합니다.',
        category: 'Math Class',
        insertSnippet: 'Math.Cos(${1:expression})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Math/cos.htm'
    },
    {
        name: 'Math.Cosh',
        kind: 'method',
        signature: 'Math.Cosh(expression)',
        summary: '쌍곡 코사인 값을 반환합니다.',
        category: 'Math Class',
        insertSnippet: 'Math.Cosh(${1:expression})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Math/cosh.htm'
    },
    {
        name: 'Math.E',
        kind: 'property',
        signature: 'Math.E',
        summary: '자연상수 $e$ 값을 반환합니다.',
        category: 'Math Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Math/e.htm'
    },
    {
        name: 'Math.Exp',
        kind: 'method',
        signature: 'Math.Exp(expression)',
        summary: '자연상수 밑 지수함수 값을 반환합니다.',
        category: 'Math Class',
        insertSnippet: 'Math.Exp(${1:expression})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Math/exp.htm'
    },
    {
        name: 'Math.Floor',
        kind: 'method',
        signature: 'Math.Floor(expression)',
        summary: '바닥값(내림 정수)을 반환합니다.',
        category: 'Math Class',
        insertSnippet: 'Math.Floor(${1:expression})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Math/floor.htm'
    },
    {
        name: 'Math.Log',
        kind: 'method',
        signature: 'Math.Log(expression)',
        summary: '자연로그 값을 반환합니다.',
        category: 'Math Class',
        insertSnippet: 'Math.Log(${1:expression})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Math/log.htm'
    },
    {
        name: 'Math.Log10',
        kind: 'method',
        signature: 'Math.Log10(expression)',
        summary: '상용로그 값을 반환합니다.',
        category: 'Math Class',
        insertSnippet: 'Math.Log10(${1:expression})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Math/log10.htm'
    },
    {
        name: 'Math.Max',
        kind: 'method',
        signature: 'Math.Max(a, b)',
        summary: '두 값 중 큰 값을 반환합니다.',
        category: 'Math Class',
        insertSnippet: 'Math.Max(${1:a}, ${2:b})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Math/max.htm'
    },
    {
        name: 'Math.Min',
        kind: 'method',
        signature: 'Math.Min(a, b)',
        summary: '두 값 중 작은 값을 반환합니다.',
        category: 'Math Class',
        insertSnippet: 'Math.Min(${1:a}, ${2:b})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Math/min.htm'
    },
    {
        name: 'Math.PI',
        kind: 'property',
        signature: 'Math.PI',
        summary: '원주율 $\pi$ 값을 반환합니다.',
        category: 'Math Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Math/pi.htm'
    },
    {
        name: 'Math.Pow',
        kind: 'method',
        signature: 'Math.Pow(x, y)',
        summary: '거듭제곱 값을 반환합니다.',
        category: 'Math Class',
        insertSnippet: 'Math.Pow(${1:x}, ${2:y})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Math/pow.htm'
    },
    {
        name: 'Math.Sign',
        kind: 'method',
        signature: 'Math.Sign(expression)',
        summary: '부호값(-1, 0, 1)을 반환합니다.',
        category: 'Math Class',
        insertSnippet: 'Math.Sign(${1:expression})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Math/sign.htm'
    },
    {
        name: 'Math.Sin',
        kind: 'method',
        signature: 'Math.Sin(expression)',
        summary: '사인 값을 반환합니다.',
        category: 'Math Class',
        insertSnippet: 'Math.Sin(${1:expression})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Math/sin.htm'
    },
    {
        name: 'Math.Sinh',
        kind: 'method',
        signature: 'Math.Sinh(expression)',
        summary: '쌍곡 사인 값을 반환합니다.',
        category: 'Math Class',
        insertSnippet: 'Math.Sinh(${1:expression})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Math/sinh.htm'
    },
    {
        name: 'Math.Sqrt',
        kind: 'method',
        signature: 'Math.Sqrt(expression)',
        summary: '제곱근 값을 반환합니다.',
        category: 'Math Class',
        insertSnippet: 'Math.Sqrt(${1:expression})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Math/sqrt.htm'
    },
    {
        name: 'Math.Tan',
        kind: 'method',
        signature: 'Math.Tan(expression)',
        summary: '탄젠트 값을 반환합니다.',
        category: 'Math Class',
        insertSnippet: 'Math.Tan(${1:expression})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Math/tan.htm'
    },
    {
        name: 'Math.Tanh',
        kind: 'method',
        signature: 'Math.Tanh(expression)',
        summary: '쌍곡 탄젠트 값을 반환합니다.',
        category: 'Math Class',
        insertSnippet: 'Math.Tanh(${1:expression})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Math/tanh.htm'
    },

    // Frequently-used class methods
    {
        name: 'Thread.Sleep',
        kind: 'method',
        signature: 'Thread.Sleep(milliseconds)',
        summary: '현재 스레드를 지정 시간 동안 대기시킵니다.',
        category: 'Thread Class',
        insertSnippet: 'Thread.Sleep(${1:milliseconds})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Thread/sleep.htm'
    },
    {
        name: 'Thread.TestAndSet',
        kind: 'method',
        signature: 'Thread.TestAndSet(target, value)',
        summary: '원자적 테스트/설정으로 동기화에 사용합니다.',
        category: 'Thread Class',
        insertSnippet: 'Thread.TestAndSet(${1:target}, ${2:value})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Thread/testandset.htm'
    },
    {
        name: 'Controller.Timer',
        kind: 'method',
        signature: 'Controller.Timer(mode)',
        summary: '제어기 타이머 값을 반환합니다.',
        category: 'Controller Class',
        insertSnippet: 'Controller.Timer(${1:mode})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Controller/timer.htm'
    },
    {
        name: 'Controller.Command',
        kind: 'method',
        signature: 'Controller.Command(commandText)',
        summary: '제어기 콘솔 명령을 실행합니다.',
        category: 'Controller Class',
        insertSnippet: 'Controller.Command(${1:commandText})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Controller/c_command.htm'
    },
    {
        name: 'XmlDoc.EncodeEntities',
        kind: 'method',
        signature: 'XmlDoc.EncodeEntities(value)',
        summary: '문자열을 XML 엔티티로 안전하게 인코딩합니다.',
        category: 'XML Class',
        insertSnippet: 'XmlDoc.EncodeEntities(${1:value})'
    },
    {
        name: 'XmlDoc.DecodeEntities',
        kind: 'method',
        signature: 'XmlDoc.DecodeEntities(value)',
        summary: 'XML 엔티티를 일반 문자열로 디코딩합니다.',
        category: 'XML Class',
        insertSnippet: 'XmlDoc.DecodeEntities(${1:value})'
    }
];

function normalize(value: string): string {
    return value.trim().toLowerCase();
}

export function getAllGplBuiltins(): readonly GPLBuiltinEntry[] {
    return GPL_BUILTINS;
}

export function getGplBuiltinReferenceUrl(entry: GPLBuiltinEntry): string {
    return entry.sourceUrl ?? GPL_DICTIONARY_ROOT_URL;
}

/**
 * 이름 또는 멤버명으로 내장 심볼을 검색한다.
 * - exact: Math.Abs
 * - tail: Abs (유일할 때)
 */
export function findGplBuiltin(name: string): GPLBuiltinEntry | undefined {
    const target = normalize(name);
    if (!target) {
        return undefined;
    }

    const exact = GPL_BUILTINS.find(b => ciEq(b.name, name));
    if (exact) {
        return exact;
    }

    const tailMatches = GPL_BUILTINS.filter(b => {
        const tail = b.name.includes('.') ? b.name.split('.').pop()! : b.name;
        return normalize(tail) === target;
    });

    if (tailMatches.length === 1) {
        return tailMatches[0];
    }

    return undefined;
}
