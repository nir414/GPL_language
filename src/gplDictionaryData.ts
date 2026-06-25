import type { GPLBuiltinEntry } from './gplBuiltins';

/**
 * Brooks GPL Dictionary(모션/로봇/위치/프로파일/기준프레임/래치/신호 클래스) 검증 데이터.
 *
 * 각 항목의 시그니처/요약은 GPL Dictionary 공식 문서 페이지에서 직접 확인했으며
 * `sourceUrl`은 그 페이지를 가리킨다. 추측 항목은 포함하지 않는다.
 *
 * 데이터 갱신 시 출처:
 *   https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/
 *
 * 주의: Location/Profile/RefFrame/Latch 멤버는 실제 코드에서 인스턴스 변수
 * (예: `pickLoc.X`)로 접근하지만, 문서 표기를 따라 `Class.Member` 형식으로 등록한다.
 * (Move/Robot/Signal은 정적 클래스라 표기 그대로 호출된다.)
 */
export const GPL_DICTIONARY_ENTRIES: GPLBuiltinEntry[] = [
    // ── Move Class ──────────────────────────────────────────────────────────
    {
        name: 'Move.Approach',
        kind: 'method',
        signature: 'Move.Approach(location, profile)',
        summary: '지정한 위치로 접근하기 전에, 위치 제어 협조 동작으로 클리어런스 위치까지 로봇을 이동시킵니다.',
        category: 'Move Class',
        insertSnippet: 'Move.Approach(${1:location}, ${2:profile})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Move/approach.htm'
    },
    {
        name: 'Move.Arc',
        kind: 'method',
        signature: 'Move.Arc(location1, location2, profile)',
        summary: '세 개의 위치 점으로 정의되는 원호 경로를 따라 로봇의 툴 팁을 이동시킵니다.',
        category: 'Move Class',
        insertSnippet: 'Move.Arc(${1:location1}, ${2:location2}, ${3:profile})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Move/arc.htm'
    },
    {
        name: 'Move.Circle',
        kind: 'method',
        signature: 'Move.Circle(location1, location2, profile)',
        summary: '세 개의 Location 값으로 정의되는 완전한 원을 따라 로봇의 툴 팁을 이동시킵니다.',
        category: 'Move Class',
        insertSnippet: 'Move.Circle(${1:location1}, ${2:location2}, ${3:profile})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Move/circle.htm'
    },
    {
        name: 'Move.Delay',
        kind: 'method',
        signature: 'Move.Delay(seconds)',
        summary: '지정한 시간(초) 동안 로봇 동작의 실행을 일시 정지합니다.',
        category: 'Move Class',
        insertSnippet: 'Move.Delay(${1:seconds})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Move/delay.htm'
    },
    {
        name: 'Move.Extra',
        kind: 'method',
        signature: 'Move.Extra(axis1, axis2, axis3, axis4)',
        summary: '다음 직교 좌표 Location 동작 중에 독립적인 추가 축들을 지정한 위치로 이동시킵니다.',
        category: 'Move Class',
        insertSnippet: 'Move.Extra(${1:axis1}, ${2:axis2}, ${3:axis3}, ${4:axis4})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Move/extra.htm'
    },
    {
        name: 'Move.ForceOverlap',
        kind: 'method',
        signature: 'Move.ForceOverlap(mode, criterion)',
        summary: '시스템의 기본 동작 블렌딩 기능을 우회하여, 연속된 두 동작이 어떻게 겹쳐 실행될지를 정의합니다.',
        category: 'Move Class',
        insertSnippet: 'Move.ForceOverlap(${1:mode}, ${2:criterion})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Move/forceoverlap.htm'
    },
    {
        name: 'Move.SetJogCommand',
        kind: 'method',
        signature: 'Move.SetJogCommand(jogMode, jogAxis, jogSpeed)',
        summary: '조그(수동) 제어 모드에서 사용할 모드, 축, 속도를 설정하거나 변경합니다.',
        category: 'Move Class',
        insertSnippet: 'Move.SetJogCommand(${1:jogMode}, ${2:jogAxis}, ${3:jogSpeed})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Move/jogcommand.htm'
    },
    {
        name: 'Move.Loc',
        kind: 'method',
        signature: 'Move.Loc(location, profile)',
        summary: '위치 제어 동작으로 로봇을 지정한 목적지로 이동시키는 기본 메서드입니다.',
        category: 'Move Class',
        insertSnippet: 'Move.Loc(${1:location}, ${2:profile})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Move/loc.htm'
    },
    {
        name: 'Move.OneAxis',
        kind: 'method',
        signature: 'Move.OneAxis(axis, position, relativeFlag, profile)',
        summary: '로봇의 단일 축을 이동시키는 편의 메서드입니다.',
        category: 'Move Class',
        insertSnippet: 'Move.OneAxis(${1:axis}, ${2:position}, ${3:relativeFlag}, ${4:profile})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Move/oneaxis.htm'
    },
    {
        name: 'Move.Rel',
        kind: 'method',
        signature: 'Move.Rel(location, profile)',
        summary: '이전 동작의 최종 위치로부터의 증분 오프셋으로 계산된 목적지로 모든 로봇 축을 이동시킵니다.',
        category: 'Move Class',
        insertSnippet: 'Move.Rel(${1:location}, ${2:profile})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Move/rel.htm'
    },
    {
        name: 'Move.SetRealTimeMod',
        kind: 'method',
        signature: 'Move.SetRealTimeMod(changesArray)',
        summary: '실시간 궤적 수정(Real-time Trajectory Modification) 모드에서의 위치/자세 증분 변화량을 설정합니다.',
        category: 'Move Class',
        insertSnippet: 'Move.SetRealTimeMod(${1:changesArray})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Move/setrtmod.htm'
    },
    {
        name: 'Move.SetSpeeds',
        kind: 'method',
        signature: 'Move.SetSpeeds(speedArray, profile)',
        summary: '속도 제어 모드로 동작 중인 로봇의 모든 축에 대해 새로운 목표 속도를 설정합니다.',
        category: 'Move Class',
        insertSnippet: 'Move.SetSpeeds(${1:speedArray}, ${2:profile})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Move/setspeeds.htm'
    },
    {
        name: 'Move.SetTorques',
        kind: 'method',
        signature: 'Move.SetTorques(torquesArray)',
        summary: '토크 제어 모드에서 모든 모터에 대해 새로운 목표 토크 출력 레벨을 설정합니다.',
        category: 'Move Class',
        insertSnippet: 'Move.SetTorques(${1:torquesArray})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Move/settorques.htm'
    },
    {
        name: 'Move.StartJogMode',
        kind: 'method',
        signature: 'Move.StartJogMode()',
        summary: '조그(수동) 제어 모드의 실행을 시작합니다.',
        category: 'Move Class',
        insertSnippet: 'Move.StartJogMode()',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Move/startjogmode.htm'
    },
    {
        name: 'Move.StartRealTimeMod',
        kind: 'method',
        signature: 'Move.StartRealTimeMod(coordinates, changeType)',
        summary: '실행 중인 계획 경로의 위치와 자세를 프로그램이 실시간으로 증분 수정할 수 있게 하는 특수 궤적 모드를 시작합니다.',
        category: 'Move Class',
        insertSnippet: 'Move.StartRealTimeMod(${1:coordinates}, ${2:changeType})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Move/startrtmod.htm'
    },
    {
        name: 'Move.StartSpeedDAC',
        kind: 'method',
        signature: 'Move.StartSpeedDAC(mode, nSegments, speedArray, dacArray)',
        summary: '로봇의 순간 툴 팁 속도를 기준으로 값이 계산되는 아날로그 출력 채널(DAC)의 자동 제어를 시작/변경/중지합니다.',
        category: 'Move Class',
        insertSnippet: 'Move.StartSpeedDAC(${1:mode}, ${2:nSegments}, ${3:speedArray}, ${4:dacArray})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Move/startspeeddac.htm'
    },
    {
        name: 'Move.StartTorqueCntrl',
        kind: 'method',
        signature: 'Move.StartTorqueCntrl(motorMask, adcMask, torquesArray)',
        summary: '하나 이상의 모터에 대해 토크 제어 모드의 실행을 시작합니다.',
        category: 'Move Class',
        insertSnippet: 'Move.StartTorqueCntrl(${1:motorMask}, ${2:adcMask}, ${3:torquesArray})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Move/starttorquecntrl.htm'
    },
    {
        name: 'Move.StartVelocityCntrl',
        kind: 'method',
        signature: 'Move.StartVelocityCntrl(mode, adcMask, speedsArray, profile)',
        summary: '로봇의 모든 축을 위치 제어에서 속도 제어 모드로 전환합니다.',
        category: 'Move Class',
        insertSnippet: 'Move.StartVelocityCntrl(${1:mode}, ${2:adcMask}, ${3:speedsArray}, ${4:profile})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Move/startvelocitycntrl.htm'
    },
    {
        name: 'Move.StopSpecialModes',
        kind: 'method',
        signature: 'Move.StopSpecialModes',
        summary: '활성화된 모든 특수 궤적 제어 모드의 실행을 종료합니다.',
        category: 'Move Class',
        insertSnippet: 'Move.StopSpecialModes',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Move/stopspecialmodes.htm'
    },
    {
        name: 'Move.Trigger',
        kind: 'method',
        signature: 'Move.Trigger(mode, triggerPt, channel)',
        summary: '다음 또는 현재 동작 중 지정한 트리거 위치에서 디지털 출력 신호 또는 스레드 이벤트를 자동 발생시키도록 준비합니다.',
        category: 'Move Class',
        insertSnippet: 'Move.Trigger(${1:mode}, ${2:triggerPt}, ${3:channel})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Move/trigger.htm'
    },
    {
        name: 'Move.WaitForEOM',
        kind: 'method',
        signature: 'Move.WaitForEOM',
        summary: '로봇이 현재 동작을 완료할 때까지 현재 스레드의 실행을 일시 중단합니다.',
        category: 'Move Class',
        insertSnippet: 'Move.WaitForEOM',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Move/waitforoem.htm'
    },

    // ── Robot Class ─────────────────────────────────────────────────────────
    {
        name: 'Robot.Attached',
        kind: 'property',
        signature: 'Robot.Attached',
        summary: '스레드가 독점적으로 제어하는 로봇 번호를 설정하거나 가져옵니다.',
        category: 'Robot Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/attached.htm'
    },
    {
        name: 'Robot.Base',
        kind: 'property',
        signature: 'Robot.Base(robot)',
        summary: '로봇 베이스에 대한 직교 좌표 위치 오프셋을 설정하거나 가져옵니다.',
        category: 'Robot Class',
        insertSnippet: 'Robot.Base(${1:robot})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/base.htm'
    },
    {
        name: 'Robot.CartMode',
        kind: 'property',
        signature: 'Robot.CartMode(robot)',
        summary: '특수 직교 궤적 모드의 활성 여부를 나타내는 플래그 비트를 담은 정수를 반환합니다.',
        category: 'Robot Class',
        insertSnippet: 'Robot.CartMode(${1:robot})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/cartmode.htm'
    },
    {
        name: 'Robot.Custom',
        kind: 'property',
        signature: 'Robot.Custom(robot, index)',
        summary: '사용자 정의 운동학 매개변수 배열의 지정한 요소 값을 설정하거나 가져옵니다.',
        category: 'Robot Class',
        insertSnippet: 'Robot.Custom(${1:robot}, ${2:index})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/custom.htm'
    },
    {
        name: 'Robot.DefLinComp',
        kind: 'method',
        signature: 'Robot.DefLinComp(robot, motor, encStart, encStep, numCor, cor)',
        summary: '지정한 모터에 대한 선형 보정 테이블을 인코더 카운트 단위로 정의합니다.',
        category: 'Robot Class',
        insertSnippet: 'Robot.DefLinComp(${1:robot}, ${2:motor}, ${3:encStart}, ${4:encStep}, ${5:numCor}, ${6:cor})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/deflincomp.htm'
    },
    {
        name: 'Robot.Dest',
        kind: 'property',
        signature: 'Robot.Dest(robot)',
        summary: '이전에 실행한 동작의 원래 계획된 최종 목적지를 직교 좌표 위치로 반환합니다.',
        category: 'Robot Class',
        insertSnippet: 'Robot.Dest(${1:robot})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/dest.htm'
    },
    {
        name: 'Robot.DestAngles',
        kind: 'property',
        signature: 'Robot.DestAngles(robot)',
        summary: '이전에 실행한 동작의 원래 계획된 최종 목적지를 각도 위치로 반환합니다.',
        category: 'Robot Class',
        insertSnippet: 'Robot.DestAngles(${1:robot})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/destangles.htm'
    },
    {
        name: 'Robot.Home',
        kind: 'method',
        signature: 'Robot.Home',
        summary: '현재 선택된 로봇을 호밍하여 축의 기준 위치를 설정합니다.',
        category: 'Robot Class',
        insertSnippet: 'Robot.Home',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/home.htm'
    },
    {
        name: 'Robot.HomeAll',
        kind: 'method',
        signature: 'Robot.HomeAll',
        summary: '모든 로봇을 호밍하여 각 축의 기준 위치를 설정합니다.',
        category: 'Robot Class',
        insertSnippet: 'Robot.HomeAll',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/homeall.htm'
    },
    {
        name: 'Robot.JointToMotor',
        kind: 'method',
        signature: 'Robot.JointToMotor(robot, jointPos, motorPos)',
        summary: '축 관절 위치 값을 모터 인코더 위치 값으로 변환합니다.',
        category: 'Robot Class',
        insertSnippet: 'Robot.JointToMotor(${1:robot}, ${2:jointPos}, ${3:motorPos})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/jointtomotor.htm'
    },
    {
        name: 'Robot.LastProfile',
        kind: 'property',
        signature: 'Robot.LastProfile(robot)',
        summary: '마지막으로 실행된 동작의 프로파일 정보를 반환합니다.',
        category: 'Robot Class',
        insertSnippet: 'Robot.LastProfile(${1:robot})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/lastprofile.htm'
    },
    {
        name: 'Robot.MotorTempStatus',
        kind: 'property',
        signature: 'Robot.MotorTempStatus(robot, motor)',
        summary: '지정한 모터의 온도 상태를 나타내는 정수 값을 반환합니다.',
        category: 'Robot Class',
        insertSnippet: 'Robot.MotorTempStatus(${1:robot}, ${2:motor})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/motortempstatus.htm'
    },
    {
        name: 'Robot.MotorToJoint',
        kind: 'method',
        signature: 'Robot.MotorToJoint(robot, motorPos, jointPos)',
        summary: '모터 인코더 위치 값을 축 관절 위치 값으로 변환합니다.',
        category: 'Robot Class',
        insertSnippet: 'Robot.MotorToJoint(${1:robot}, ${2:motorPos}, ${3:jointPos})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/motortojoint.htm'
    },
    {
        name: 'Robot.Source',
        kind: 'property',
        signature: 'Robot.Source(robot)',
        summary: '이전에 실행한 동작의 시작 위치를 직교 좌표 위치로 반환합니다.',
        category: 'Robot Class',
        insertSnippet: 'Robot.Source(${1:robot})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/origin.htm'
    },
    {
        name: 'Robot.SourceAngles',
        kind: 'property',
        signature: 'Robot.SourceAngles(robot)',
        summary: '이전에 실행한 동작의 시작 위치를 각도 위치로 반환합니다.',
        category: 'Robot Class',
        insertSnippet: 'Robot.SourceAngles(${1:robot})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/originangles.htm'
    },
    {
        name: 'Robot.Payload',
        kind: 'property',
        signature: 'Robot.Payload(robot)',
        summary: '최대 용량 대비 백분율로 표현되는 페이로드 질량을 설정하거나 가져옵니다.',
        category: 'Robot Class',
        insertSnippet: 'Robot.Payload(${1:robot})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/payload.htm'
    },
    {
        name: 'Robot.RapidDecel',
        kind: 'property',
        signature: 'Robot.RapidDecel(robot)',
        summary: '로봇의 급속 감속 설정 값을 반환합니다.',
        category: 'Robot Class',
        insertSnippet: 'Robot.RapidDecel(${1:robot})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/rapiddecel.htm'
    },
    {
        name: 'Robot.RestartBase',
        kind: 'property',
        signature: 'Robot.RestartBase(robot)',
        summary: '컨트롤러 재시작 시 설정되었던 베이스 오프셋을 반환합니다.',
        category: 'Robot Class',
        insertSnippet: 'Robot.RestartBase(${1:robot})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/restartbase.htm'
    },
    {
        name: 'Robot.RestartTool',
        kind: 'property',
        signature: 'Robot.RestartTool(robot)',
        summary: '컨트롤러 재시작 시 설정되었던 툴/그리퍼의 위치 및 방향 오프셋을 반환합니다.',
        category: 'Robot Class',
        insertSnippet: 'Robot.RestartTool(${1:robot})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/restarttool.htm'
    },
    {
        name: 'Robot.RealTimeModAcm',
        kind: 'property',
        signature: 'Robot.RealTimeModAcm(robot)',
        summary: '실시간 궤적 수정 모드로 생성된 누적 경로 수정량을 직교 좌표 위치로 반환합니다.',
        category: 'Robot Class',
        insertSnippet: 'Robot.RealTimeModAcm(${1:robot})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/rtmodaccum.htm'
    },
    {
        name: 'Robot.Selected',
        kind: 'property',
        signature: 'Robot.Selected',
        summary: '특정 로봇 접근 시 사용할 기본 로봇 번호를 설정하거나 가져옵니다.',
        category: 'Robot Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/selected.htm'
    },
    {
        name: 'Robot.SpeedAngles',
        kind: 'property',
        signature: 'Robot.SpeedAngles(robot)',
        summary: '로봇 각 축의 속도 정보를 각도 위치 객체로 반환합니다.',
        category: 'Robot Class',
        insertSnippet: 'Robot.SpeedAngles(${1:robot})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/speedangles.htm'
    },
    {
        name: 'Robot.Tool',
        kind: 'property',
        signature: 'Robot.Tool(robot)',
        summary: '로봇 툴/그리퍼의 위치 및 방향 오프셋을 설정하거나 가져옵니다.',
        category: 'Robot Class',
        insertSnippet: 'Robot.Tool(${1:robot})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/tool.htm'
    },
    {
        name: 'Robot.TrajState',
        kind: 'property',
        signature: 'Robot.TrajState(robot, mode)',
        summary: '지정한 모드에 따라 로봇 궤적 상태 정보를 반환합니다.',
        category: 'Robot Class',
        insertSnippet: 'Robot.TrajState(${1:robot}, ${2:mode})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/trajstate.htm'
    },
    {
        name: 'Robot.Where',
        kind: 'property',
        signature: 'Robot.Where(robot)',
        summary: '베이스와 툴 오프셋을 반영한 로봇의 현재 위치와 방향을 직교 좌표 위치로 반환합니다.',
        category: 'Robot Class',
        insertSnippet: 'Robot.Where(${1:robot})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/where.htm'
    },
    {
        name: 'Robot.WhereAngles',
        kind: 'property',
        signature: 'Robot.WhereAngles(robot)',
        summary: '각 모터의 순간 인코더 값을 읽어 로봇의 현재 축 위치를 각도 위치로 반환합니다.',
        category: 'Robot Class',
        insertSnippet: 'Robot.WhereAngles(${1:robot})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/whereangles.htm'
    },

    // ── Location Class (인스턴스 멤버, 문서 표기 기준) ─────────────────────────
    {
        name: 'Location.Angle',
        kind: 'property',
        signature: 'Location.Angle(axis)',
        summary: 'Angles 위치 객체에서 지정한 축(1~12)의 위치 값을 mm 또는 도 단위로 읽거나 설정합니다.',
        category: 'Location Class',
        insertSnippet: 'Angle(${1:axis})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/angle.htm'
    },
    {
        name: 'Location.Angles',
        kind: 'method',
        signature: 'Location.Angles(axis1, ..., axis12)',
        summary: 'Angles 위치 객체의 모든 축 위치 값을 최대 12개의 인수로 한 번에 설정합니다.',
        category: 'Location Class',
        insertSnippet: 'Angles(${1:axis1}, ${2:axis2})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/angles.htm'
    },
    {
        name: 'Location.Clone',
        kind: 'method',
        signature: 'Location.Clone',
        summary: 'Location 객체의 독립적인 복사본을 생성하여 반환합니다.',
        category: 'Location Class',
        insertSnippet: 'Clone',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/clone.htm'
    },
    {
        name: 'Location.Config',
        kind: 'property',
        signature: 'Location.Config',
        summary: '데카르트 위치를 축 위치 값으로 변환하는 방식을 제어하는 정수 비트마스크를 읽거나 설정합니다.',
        category: 'Location Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/config.htm'
    },
    {
        name: 'Location.ConveyorLimit',
        kind: 'method',
        signature: 'Location.ConveyorLimit(mode)',
        summary: '컨베이어 기준 프레임에 정의된 Location이 컨베이어 벨트 동작 한계로부터 떨어진 거리를 반환합니다.',
        category: 'Location Class',
        insertSnippet: 'ConveyorLimit(${1:mode})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/conveyorlimits.htm'
    },
    {
        name: 'Location.Distance',
        kind: 'method',
        signature: 'Location.Distance(location1, location2)',
        summary: '두 데카르트 위치 객체의 XYZ 위치 사이 거리를 Double 값으로 계산하여 반환합니다.',
        category: 'Location Class',
        insertSnippet: 'Location.Distance(${1:location1}, ${2:location2})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/distance.htm'
    },
    {
        name: 'Location.Here',
        kind: 'method',
        signature: 'Location.Here',
        summary: '선택된 로봇의 현재 위치와 방향을 Location 객체의 전체 위치 값으로 설정합니다.',
        category: 'Location Class',
        insertSnippet: 'Here',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/here.htm'
    },
    {
        name: 'Location.Here3',
        kind: 'method',
        signature: 'Location.Here3(location0, locationX, locationY)',
        summary: '세 개의 데카르트 위치 객체의 XYZ 좌표를 사용해 Location 객체의 위치와 방향을 정의합니다.',
        category: 'Location Class',
        insertSnippet: 'Here3(${1:location0}, ${2:locationX}, ${3:locationY})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/here3.htm'
    },
    {
        name: 'Location.Inverse',
        kind: 'method',
        signature: 'Location.Inverse',
        summary: '데카르트 위치 객체의 전체 위치 값에 대한 역변환을 반환합니다.',
        category: 'Location Class',
        insertSnippet: 'Inverse',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/inverse.htm'
    },
    {
        name: 'Location.KineSol',
        kind: 'method',
        signature: 'Location.KineSol(mode, location)',
        summary: '특정 운동학 모델에 대해 Angles 위치 객체와 동등한 데카르트 위치 객체를 반환하거나 그 반대로 변환합니다.',
        category: 'Location Class',
        insertSnippet: 'KineSol(${1:mode}, ${2:location})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/kinesol.htm'
    },
    {
        name: 'Location.Mul',
        kind: 'method',
        signature: 'Location.Mul(location2)',
        summary: '한 데카르트 위치 객체의 위치와 방향을 다른 위치 객체와 결합한 변환 결과를 반환합니다.',
        category: 'Location Class',
        insertSnippet: 'Mul(${1:location2})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/mul.htm'
    },
    {
        name: 'Location.Normalize',
        kind: 'method',
        signature: 'Location.Normalize',
        summary: '데카르트 위치 객체의 PosWrtRef 값에 누적된 수학적 불일치를 보정합니다.',
        category: 'Location Class',
        insertSnippet: 'Normalize',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/normalize.htm'
    },
    {
        name: 'Location.Pitch',
        kind: 'property',
        signature: 'Location.Pitch',
        summary: '데카르트 위치 객체 PosWrtRef 값의 Pitch 각도(도)를 읽거나 설정합니다.',
        category: 'Location Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/pitch.htm'
    },
    {
        name: 'Location.Pos',
        kind: 'property',
        signature: 'Location.Pos',
        summary: 'Location 객체의 전체 위치 값을 읽거나 설정합니다.',
        category: 'Location Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/pos.htm'
    },
    {
        name: 'Location.PosWrtRef',
        kind: 'property',
        signature: 'Location.PosWrtRef',
        summary: '기준 프레임 데이터를 무시한 채 데카르트 위치 객체의 기준 프레임 기준 위치 값을 읽거나 설정합니다.',
        category: 'Location Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/poswrtref.htm'
    },
    {
        name: 'Location.RefFrame',
        kind: 'property',
        signature: 'Location.RefFrame',
        summary: 'Location 객체의 위치와 방향이 정의되는 기준 프레임 객체에 대한 포인터를 읽거나 설정합니다.',
        category: 'Location Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/refframe.htm'
    },
    {
        name: 'Location.Roll',
        kind: 'property',
        signature: 'Location.Roll',
        summary: '데카르트 위치 객체 PosWrtRef 값의 Roll 각도(도)를 읽거나 설정합니다.',
        category: 'Location Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/roll.htm'
    },
    {
        name: 'Location.Text',
        kind: 'property',
        signature: 'Location.Text',
        summary: 'Location 객체에 연결된 임의의 문자열 값을 읽거나 설정합니다.',
        category: 'Location Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/text.htm'
    },
    {
        name: 'Location.Type',
        kind: 'property',
        signature: 'Location.Type',
        summary: 'Location 객체가 데카르트(0) 또는 Angles(1) 데이터를 담는지 나타내는 정수 값을 읽거나 설정합니다.',
        category: 'Location Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/type.htm'
    },
    {
        name: 'Location.X',
        kind: 'property',
        signature: 'Location.X',
        summary: '데카르트 위치 객체 PosWrtRef 값의 X축 변위(mm)를 읽거나 설정합니다.',
        category: 'Location Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/x.htm'
    },
    {
        name: 'Location.XYZ',
        kind: 'method',
        signature: 'Location.XYZ(x, y, z, yaw, pitch, roll)',
        summary: '데카르트 위치 객체의 X, Y, Z, Yaw, Pitch, Roll 좌표를 한 번에 설정합니다.',
        category: 'Location Class',
        insertSnippet: 'XYZ(${1:x}, ${2:y}, ${3:z}, ${4:yaw}, ${5:pitch}, ${6:roll})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/xyz.htm'
    },
    {
        name: 'Location.XYZInc',
        kind: 'method',
        signature: 'Location.XYZInc(x, y, z)',
        summary: '데카르트 위치 객체 PosWrtRef 값의 X, Y, Z 변위 성분을 증분합니다.',
        category: 'Location Class',
        insertSnippet: 'XYZInc(${1:x}, ${2:y}, ${3:z})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/xyzinc.htm'
    },
    {
        name: 'Location.XYZValue',
        kind: 'method',
        signature: 'Location.XYZValue(x, y, z, yaw, pitch, roll)',
        summary: '지정한 X, Y, Z, Yaw, Pitch, Roll 좌표와 동일한 전체 위치를 가진 데카르트 Location을 반환합니다.',
        category: 'Location Class',
        insertSnippet: 'Location.XYZValue(${1:x}, ${2:y}, ${3:z}, ${4:yaw}, ${5:pitch}, ${6:roll})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/xyzvalue.htm'
    },
    {
        name: 'Location.Y',
        kind: 'property',
        signature: 'Location.Y',
        summary: '데카르트 위치 객체 PosWrtRef 값의 Y축 변위(mm)를 읽거나 설정합니다.',
        category: 'Location Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/y.htm'
    },
    {
        name: 'Location.Yaw',
        kind: 'property',
        signature: 'Location.Yaw',
        summary: '데카르트 위치 객체 PosWrtRef 값의 Yaw 각도(도)를 읽거나 설정합니다.',
        category: 'Location Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/yaw.htm'
    },
    {
        name: 'Location.Z',
        kind: 'property',
        signature: 'Location.Z',
        summary: '데카르트 위치 객체 PosWrtRef 값의 Z축 변위(mm)를 읽거나 설정합니다.',
        category: 'Location Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/z.htm'
    },
    {
        name: 'Location.ZClearance',
        kind: 'property',
        signature: 'Location.ZClearance',
        summary: 'Location 객체로의 안전 접근 위치를 정의하는 Z축 방향 거리(mm)를 읽거나 설정합니다.',
        category: 'Location Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/zclearance.htm'
    },
    {
        name: 'Location.ZWorld',
        kind: 'property',
        signature: 'Location.ZWorld',
        summary: 'ZClearance 거리를 월드 Z축 기준으로 해석할지 툴 Z축 기준으로 해석할지를 결정하는 Boolean 플래그를 읽거나 설정합니다.',
        category: 'Location Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/zworld.htm'
    },

    // ── Profile Class (인스턴스 멤버, 문서 표기 기준) ──────────────────────────
    {
        name: 'Profile.Accel',
        kind: 'property',
        signature: 'Profile.Accel',
        summary: '모션 프로파일의 가속도 값을 설정하거나 읽습니다.',
        category: 'Profile Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Profile_class/accel.htm'
    },
    {
        name: 'Profile.AccelRamp',
        kind: 'property',
        signature: 'Profile.AccelRamp',
        summary: '프로파일의 가속 램프(저크 제한) 시간을 설정하거나 읽습니다.',
        category: 'Profile Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Profile_class/accelramp.htm'
    },
    {
        name: 'Profile.Decel',
        kind: 'property',
        signature: 'Profile.Decel',
        summary: '모션 프로파일의 감속도 값을 설정하거나 읽습니다.',
        category: 'Profile Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Profile_class/decel.htm'
    },
    {
        name: 'Profile.DecelRamp',
        kind: 'property',
        signature: 'Profile.DecelRamp',
        summary: '프로파일의 감속 램프(저크 제한) 시간을 설정하거나 읽습니다.',
        category: 'Profile Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Profile_class/decelramp.htm'
    },
    {
        name: 'Profile.InRange',
        kind: 'property',
        signature: 'Profile.InRange',
        summary: '모션 종료 시 목표 위치 도달 정밀도(인레인지) 조건을 설정하거나 읽습니다.',
        category: 'Profile Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Profile_class/inrange.htm'
    },
    {
        name: 'Profile.Speed',
        kind: 'property',
        signature: 'Profile.Speed',
        summary: '모션 프로파일의 속도 값을 설정하거나 읽습니다.',
        category: 'Profile Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Profile_class/speed_property.htm'
    },
    {
        name: 'Profile.Speed2',
        kind: 'property',
        signature: 'Profile.Speed2',
        summary: '모션의 두 번째(보조) 속도 값을 설정하거나 읽습니다.',
        category: 'Profile Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Profile_class/speed2.htm'
    },
    {
        name: 'Profile.Straight',
        kind: 'property',
        signature: 'Profile.Straight',
        summary: '모션을 직선(스트레이트 라인) 경로로 수행할지 여부를 설정하거나 읽습니다.',
        category: 'Profile Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Profile_class/straight.htm'
    },
    {
        name: 'Profile.Text',
        kind: 'property',
        signature: 'Profile.Text',
        summary: '프로파일 객체에 연결된 설명용 문자열을 설정하거나 읽습니다.',
        category: 'Profile Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Profile_class/pf_text.htm'
    },
    {
        name: 'Profile.Clone',
        kind: 'method',
        signature: 'Profile.Clone',
        summary: '현재 프로파일 객체의 복사본을 생성하여 반환합니다.',
        category: 'Profile Class',
        insertSnippet: 'Clone',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Profile_class/profileclone.htm'
    },

    // ── Reference Frame Class (인스턴스 멤버, 문서 표기 기준) ───────────────────
    {
        name: 'RefFrame.ConveyorOffset',
        kind: 'property',
        signature: 'RefFrame.ConveyorOffset',
        summary: '컨베이어 추종 기준 프레임의 엔코더 오프셋 값을 설정하거나 읽습니다.',
        category: 'Reference Frame Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Reference_Frame/conveyoroffset.htm'
    },
    {
        name: 'RefFrame.ConveyorRobot',
        kind: 'property',
        signature: 'RefFrame.ConveyorRobot',
        summary: '컨베이어 기준 프레임이 연결될 로봇 번호를 설정하거나 읽습니다.',
        category: 'Reference Frame Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Reference_Frame/conveyorrobot.htm'
    },
    {
        name: 'RefFrame.PalletIndex',
        kind: 'property',
        signature: 'RefFrame.PalletIndex(rowColLay)',
        summary: '팔레트 기준 프레임의 지정 차원에 대한 현재 인덱스 값을 설정하거나 읽습니다.',
        category: 'Reference Frame Class',
        insertSnippet: 'PalletIndex(${1:rowColLay})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Reference_Frame/palletindex.htm'
    },
    {
        name: 'RefFrame.PalletMaxIndex',
        kind: 'property',
        signature: 'RefFrame.PalletMaxIndex(rowColLay)',
        summary: '팔레트 기준 프레임의 지정 차원에 대한 최대 인덱스 값을 설정하거나 읽습니다.',
        category: 'Reference Frame Class',
        insertSnippet: 'PalletMaxIndex(${1:rowColLay})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Reference_Frame/palletmaxindex.htm'
    },
    {
        name: 'RefFrame.PalletNextPos',
        kind: 'method',
        signature: 'RefFrame.PalletNextPos',
        summary: '팔레트 인덱스를 다음 위치로 진행시키고 해당 위치를 반환합니다.',
        category: 'Reference Frame Class',
        insertSnippet: 'PalletNextPos',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Reference_Frame/palletnextpos.htm'
    },
    {
        name: 'RefFrame.PalletOrder',
        kind: 'property',
        signature: 'RefFrame.PalletOrder',
        summary: '팔레트 위치를 순회할 때의 인덱싱 순서를 설정하거나 읽습니다.',
        category: 'Reference Frame Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Reference_Frame/palletorder.htm'
    },
    {
        name: 'RefFrame.PalletPitch',
        kind: 'property',
        signature: 'RefFrame.PalletPitch(rowColLay)',
        summary: '팔레트 기준 프레임의 지정 차원에 대한 셀 간 간격(피치)을 설정하거나 읽습니다.',
        category: 'Reference Frame Class',
        insertSnippet: 'PalletPitch(${1:rowColLay})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Reference_Frame/palletpitch.htm'
    },
    {
        name: 'RefFrame.PalletRowColLay',
        kind: 'method',
        signature: 'RefFrame.PalletRowColLay(row, column, layer)',
        summary: '지정한 행·열·층 좌표에 해당하는 팔레트 셀 위치를 계산하여 반환합니다.',
        category: 'Reference Frame Class',
        insertSnippet: 'PalletRowColLay(${1:row}, ${2:column}, ${3:layer})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Reference_Frame/palletrowcollay.htm'
    },
    {
        name: 'RefFrame.Loc',
        kind: 'property',
        signature: 'RefFrame.Loc',
        summary: '기준 프레임을 정의하는 직교 좌표 위치 객체를 설정하거나 읽습니다.',
        category: 'Reference Frame Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Reference_Frame/rf_loc.htm'
    },
    {
        name: 'RefFrame.Pos',
        kind: 'method',
        signature: 'RefFrame.Pos(location)',
        summary: '주어진 위치를 이 기준 프레임 기준으로 변환한 위치를 반환합니다.',
        category: 'Reference Frame Class',
        insertSnippet: 'Pos(${1:location})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Reference_Frame/rf_pos.htm'
    },
    {
        name: 'RefFrame.PosWrtRef',
        kind: 'method',
        signature: 'RefFrame.PosWrtRef(location)',
        summary: '주어진 위치를 이 기준 프레임의 참조 프레임 기준으로 표현한 위치를 반환합니다.',
        category: 'Reference Frame Class',
        insertSnippet: 'PosWrtRef(${1:location})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Reference_Frame/rf_poswrtref.htm'
    },
    {
        name: 'RefFrame.Text',
        kind: 'property',
        signature: 'RefFrame.Text',
        summary: '기준 프레임 객체에 연결된 설명용 문자열을 설정하거나 읽습니다.',
        category: 'Reference Frame Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Reference_Frame/rf_text.htm'
    },
    {
        name: 'RefFrame.Type',
        kind: 'property',
        signature: 'RefFrame.Type',
        summary: '기준 프레임의 종류를 나타내는 정수 타입 값을 설정하거나 읽습니다.',
        category: 'Reference Frame Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Reference_Frame/rf_type.htm'
    },

    // ── Latch Class (인스턴스/정적 혼합, 문서 표기 기준) ───────────────────────
    {
        name: 'Latch.Angle',
        kind: 'property',
        signature: 'Latch.Angle(axis)',
        summary: '래치 발생 시점에 캡처된 지정 축의 각도(위치) 값을 반환합니다.',
        category: 'Latch Class',
        insertSnippet: 'Angle(${1:axis})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Latch/lat_angle.htm'
    },
    {
        name: 'Latch.Count',
        kind: 'property',
        signature: 'Latch.Count(robot)',
        summary: '지정한 로봇에 대해 대기 중인 래치 데이터의 개수를 반환합니다.',
        category: 'Latch Class',
        insertSnippet: 'Latch.Count(${1:robot})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Latch/lat_count.htm'
    },
    {
        name: 'Latch.ErrorCode',
        kind: 'property',
        signature: 'Latch.ErrorCode',
        summary: '래치 동작과 관련된 오류 코드를 반환합니다.',
        category: 'Latch Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Latch/lat_errorcode.htm'
    },
    {
        name: 'Latch.Flush',
        kind: 'method',
        signature: 'Latch.Flush(robot)',
        summary: '지정한 로봇에 대해 대기 중인 모든 래치 데이터를 비웁니다.',
        category: 'Latch Class',
        insertSnippet: 'Latch.Flush(${1:robot})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Latch/lat_flush.htm'
    },
    {
        name: 'Latch.Location',
        kind: 'method',
        signature: 'Latch.Location(type)',
        summary: '래치 발생 시점에 캡처된 로봇 위치를 지정한 형식의 위치 객체로 반환합니다.',
        category: 'Latch Class',
        insertSnippet: 'Location(${1:type})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Latch/lat_location.htm'
    },
    {
        name: 'Latch.RawTime',
        kind: 'property',
        signature: 'Latch.RawTime',
        summary: '래치 이벤트가 발생한 원시(raw) 타임스탬프 값을 반환합니다.',
        category: 'Latch Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Latch/lat_rawtime.htm'
    },
    {
        name: 'Latch.Result',
        kind: 'method',
        signature: 'Latch.Result(robot, noException)',
        summary: '지정한 로봇의 다음 래치 데이터를 가져와 래치 객체로 반환합니다.',
        category: 'Latch Class',
        insertSnippet: 'Latch.Result(${1:robot}, ${2:noException})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Latch/lat_result.htm'
    },
    {
        name: 'Latch.Signal',
        kind: 'property',
        signature: 'Latch.Signal',
        summary: '래치를 트리거한 신호 번호를 반환합니다.',
        category: 'Latch Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Latch/lat_signal.htm'
    },
    {
        name: 'Latch.ThreadEvent',
        kind: 'property',
        signature: 'Latch.ThreadEvent(robot)',
        summary: '지정한 로봇의 래치 이벤트 발생 시 스레드에 통지할 이벤트 마스크를 설정하거나 읽습니다.',
        category: 'Latch Class',
        insertSnippet: 'Latch.ThreadEvent(${1:robot})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Latch/lat_threadevent.htm'
    },
    {
        name: 'Latch.Timestamp',
        kind: 'property',
        signature: 'Latch.Timestamp(select)',
        summary: '래치 이벤트가 발생한 시각을 지정한 선택 기준에 따라 반환합니다.',
        category: 'Latch Class',
        insertSnippet: 'Timestamp(${1:select})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Latch/lat_timestamp.htm'
    },

    // ── Signal Class ──────────────────────────────────────────────────────────
    {
        name: 'Signal.DIO',
        kind: 'property',
        signature: 'Signal.DIO(channel, count)',
        summary: '지정한 채널의 디지털 입출력 신호 값을 설정하거나 읽습니다.',
        category: 'Signal Class',
        insertSnippet: 'Signal.DIO(${1:channel}, ${2:count})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Signal/Dio.htm'
    },
    {
        name: 'Signal.AIO',
        kind: 'property',
        signature: 'Signal.AIO(channel)',
        summary: '지정한 채널의 아날로그 입출력 신호 값을 설정하거나 읽습니다.',
        category: 'Signal Class',
        insertSnippet: 'Signal.AIO(${1:channel})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Signal/Aio.htm'
    }
];
