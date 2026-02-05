/// <summary>
/// GPL Base Codeunit - Foundation for GPL Language Extension
/// </summary>
codeunit 50100 "GPL Base"
{
    /// <summary>
    /// Initialize GPL Language Extension
    /// </summary>
    procedure Initialize()
    begin
        Message('GPL Language Extension initialized successfully.');
    end;

    /// <summary>
    /// Get Version Information
    /// </summary>
    procedure GetVersion(): Text
    begin
        exit('1.0.0.0');
    end;

    /// <summary>
    /// Validate GPL Setup
    /// </summary>
    procedure ValidateSetup(): Boolean
    begin
        exit(true);
    end;
}
