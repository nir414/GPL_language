import { ciEq } from './config';
import { GPL_DICTIONARY_ENTRIES } from './gplDictionaryData';

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

const GPL_CORE_BUILTINS: GPLBuiltinEntry[] = [
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
        signature: 'Rnd(seed)',
        summary: '0.0 이상 1.0 미만의 의사난수를 반환합니다. seed는 생략 가능하며, 음수면 그 값을 시작점으로 시퀀스를 재시작(항상 같은 값), 0이면 직전 반환값을 다시 돌려줍니다.',
        category: 'Functions',
        insertSnippet: 'Rnd(${1:seed})',
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
        // 문서 기준 Trim은 전역 함수가 아니라 String 클래스 인스턴스 메서드(string.Trim)다.
        // (공식 "Strings and String Expressions Overview" Table 19-8 / String/trim.htm)
        name: 'String.Trim',
        kind: 'method',
        signature: 'string.Trim',
        summary: '문자열 인스턴스의 앞뒤 공백(또는 지정 문자)을 제거한 새 문자열을 반환합니다. (string 인스턴스에 대해 호출)',
        category: 'String',
        insertSnippet: 'Trim',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/String/trim.htm'
    },
    // 주의: 'Replace'는 GPL Dictionary(번들·공식 모두)에서 확인되지 않아 제거함.
    // 공식 String 멤버 표(Table 19-8)/함수 표(Table 19-9) 어디에도 없고 String/replace.htm은 빈 페이지.
    // 컨트롤러/GDE에서 string.Replace(...) 동작이 실측 확인되면, 정확한 시그니처와 sourceUrl을 채워 재등록할 것.
    {
        name: 'Asc',
        kind: 'function',
        signature: 'Asc(string)',
        summary: '문자열의 첫 문자를 동등한 ASCII 정수 코드로 변환해 반환합니다.',
        category: 'String',
        insertSnippet: 'Asc(${1:string})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/String/asc.htm'
    },
    {
        name: 'Chr',
        kind: 'function',
        signature: 'Chr(expression)',
        summary: 'ASCII 코드 값에 해당하는 문자 하나로 이루어진 문자열을 반환합니다.',
        category: 'String',
        insertSnippet: 'Chr(${1:expression})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/String/chr.htm'
    },
    {
        name: 'Format',
        kind: 'function',
        signature: 'Format(expression, format_s)',
        summary: '숫자 값을 지정한 출력 형식 사양에 따라 문자열로 변환합니다.',
        category: 'String',
        insertSnippet: 'Format(${1:expression}, ${2:format_s})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/String/format.htm'
    },
    {
        name: 'LCase',
        kind: 'function',
        signature: 'LCase(string)',
        summary: '문자열을 소문자로 변환한 값을 반환합니다.',
        category: 'String',
        insertSnippet: 'LCase(${1:string})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/String/lcase.htm'
    },
    {
        name: 'UCase',
        kind: 'function',
        signature: 'UCase(string)',
        summary: '문자열을 대문자로 변환한 값을 반환합니다.',
        category: 'String',
        insertSnippet: 'UCase(${1:string})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/String/ucase.htm'
    },
    {
        name: 'FromBitString',
        kind: 'function',
        signature: 'FromBitString(string, type, big_endian)',
        summary: '문자열 안에 내부 비트 형식으로 패킹된 숫자를 추출하여 그 값을 반환합니다.',
        category: 'String',
        insertSnippet: 'FromBitString(${1:string}, ${2:type}, ${3:big_endian})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/String/frombitstring.htm'
    },
    {
        name: 'ToBitString',
        kind: 'function',
        signature: 'ToBitString(expression, type, big_endian)',
        summary: '식의 값을 특정 숫자 형식으로 변환하고, 그 내부 비트 표현을 문자열로 패킹하여 반환합니다.',
        category: 'String',
        insertSnippet: 'ToBitString(${1:expression}, ${2:type}, ${3:big_endian})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/String/tobitstring.htm'
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
        summary: '자연상수 e(약 2.71828)의 값을 반환합니다.',
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
        summary: '원주율 π(약 3.14159)의 값을 반환합니다.',
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

/**
 * hover/completion에서 사용하는 전체 내장 심볼 목록.
 * 핵심 변환/문자열/Math/Thread 등(GPL_CORE_BUILTINS)과
 * GPL Dictionary 모션/로봇/위치 클래스 데이터(GPL_DICTIONARY_ENTRIES)를 합친다.
 */
const GPL_BUILTINS: GPLBuiltinEntry[] = [...GPL_CORE_BUILTINS, ...GPL_DICTIONARY_ENTRIES];

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

    // Tail 매칭은 접두사 없이 bare로 호출되는 최상위 함수(예: Mid, Trim, CInt)에만 적용한다.
    // 클래스 멤버(Math.Cos, Move.Loc, Robot.Home 등)는 GPL에서 항상 'Class.' 접두사가
    // 필요하므로 bare 단어와 매칭하면 동명의 사용자 식별자를 오인식한다. 정규형은 위의
    // exact 매칭으로 이미 처리된다.
    const tailMatches = GPL_BUILTINS.filter(b => {
        if (b.kind !== 'function') {
            return false;
        }
        const tail = b.name.includes('.') ? b.name.split('.').pop()! : b.name;
        return normalize(tail) === target;
    });

    if (tailMatches.length === 1) {
        return tailMatches[0];
    }

    return undefined;
}
