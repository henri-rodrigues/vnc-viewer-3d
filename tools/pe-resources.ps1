# Grava recursos (RT_RCDATA e ícone) num .exe usando a API do Windows.
# Uso:
#   pe-resources.ps1 -Exe app.exe -List
#   pe-resources.ps1 -Exe app.exe -BlobName NODE_SEA_BLOB -BlobFile blob -IconFile icon.ico
param(
    [Parameter(Mandatory)] [string] $Exe,
    [switch] $List,
    [string] $BlobName,
    [string] $BlobFile,
    [string] $IconFile
)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class PeRes {
    [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern IntPtr BeginUpdateResource(string file, bool deleteExisting);
    [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool UpdateResource(IntPtr h, IntPtr type, IntPtr name, ushort lang, byte[] data, uint size);
    [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode, EntryPoint = "UpdateResource")]
    static extern bool UpdateResourceNamed(IntPtr h, IntPtr type, string name, ushort lang, byte[] data, uint size);
    [DllImport("kernel32", SetLastError = true)]
    static extern bool EndUpdateResource(IntPtr h, bool discard);

    [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern IntPtr LoadLibraryEx(string file, IntPtr reserved, uint flags);
    [DllImport("kernel32")] static extern bool FreeLibrary(IntPtr h);
    delegate bool EnumNameProc(IntPtr h, IntPtr type, IntPtr name, IntPtr param);
    delegate bool EnumLangProc(IntPtr h, IntPtr type, IntPtr name, ushort lang, IntPtr param);
    [DllImport("kernel32", CharSet = CharSet.Unicode)]
    static extern bool EnumResourceNames(IntPtr h, IntPtr type, EnumNameProc cb, IntPtr param);
    [DllImport("kernel32", CharSet = CharSet.Unicode)]
    static extern bool EnumResourceLanguages(IntPtr h, IntPtr type, IntPtr name, EnumLangProc cb, IntPtr param);

    const int RT_ICON = 3, RT_RCDATA = 10, RT_GROUP_ICON = 14;

    static bool IsId(IntPtr p) { return ((ulong)p.ToInt64() >> 16) == 0; }

    // Lista "tipo:nome:idioma" dos ícones.
    public static List<string> List(string file) {
        var res = new List<string>();
        IntPtr m = LoadLibraryEx(file, IntPtr.Zero, 0x2 /* LOAD_LIBRARY_AS_DATAFILE */);
        if (m == IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
        foreach (int t in new[] { RT_ICON, RT_GROUP_ICON }) {
            EnumResourceNames(m, (IntPtr)t, (h, type, name, p) => {
                string n = IsId(name) ? name.ToInt64().ToString() : Marshal.PtrToStringUni(name);
                EnumResourceLanguages(h, type, name, (h2, ty, na, lang, p2) => { res.Add(t + ":" + n + ":" + lang); return true; }, IntPtr.Zero);
                return true;
            }, IntPtr.Zero);
        }
        FreeLibrary(m);
        return res;
    }

    // icons: RT_ICON ids e dados; group: dados do RT_GROUP_ICON. Remove os ícones antigos listados em old.
    public static void Write(string file, string blobName, byte[] blob, ushort[] iconIds, byte[][] icons,
                             byte[] group, string groupName, string[] old) {
        IntPtr h = BeginUpdateResource(file, false);
        if (h == IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
        try {
            foreach (string o in old) {
                string[] p = o.Split(':');
                IntPtr type = (IntPtr)int.Parse(p[0]);
                ushort lang = ushort.Parse(p[2]);
                int id;
                bool ok = int.TryParse(p[1], out id)
                    ? UpdateResource(h, type, (IntPtr)id, lang, null, 0)
                    : UpdateResourceNamed(h, type, p[1], lang, null, 0);
                if (!ok) throw new System.ComponentModel.Win32Exception();
            }
            if (blob != null && !UpdateResourceNamed(h, (IntPtr)RT_RCDATA, blobName, 0, blob, (uint)blob.Length))
                throw new System.ComponentModel.Win32Exception();
            if (icons != null) {
                for (int i = 0; i < icons.Length; i++)
                    if (!UpdateResource(h, (IntPtr)RT_ICON, (IntPtr)iconIds[i], 0, icons[i], (uint)icons[i].Length))
                        throw new System.ComponentModel.Win32Exception();
                if (!UpdateResourceNamed(h, (IntPtr)RT_GROUP_ICON, groupName, 0, group, (uint)group.Length))
                    throw new System.ComponentModel.Win32Exception();
            }
        } catch { EndUpdateResource(h, true); throw; }
        if (!EndUpdateResource(h, false)) throw new System.ComponentModel.Win32Exception();
    }
}
'@

$Exe = (Resolve-Path $Exe).Path
$existing = [PeRes]::List($Exe)
if ($List) { $existing; return }

$blob = $null
if ($BlobFile) { $blob = [IO.File]::ReadAllBytes((Resolve-Path $BlobFile).Path) }

$ids = $null; $icons = $null; $group = $null; $old = @()
if ($IconFile) {
    # Converte o .ico (ICONDIR + entradas de 16 bytes) em RT_ICON + RT_GROUP_ICON (entradas de 14 bytes).
    $ico = [IO.File]::ReadAllBytes((Resolve-Path $IconFile).Path)
    $count = [BitConverter]::ToUInt16($ico, 4)
    $ids = New-Object 'uint16[]' $count
    $icons = New-Object 'byte[][]' $count
    $group = New-Object byte[] (6 + 14 * $count)
    [Array]::Copy($ico, 0, $group, 0, 6)
    for ($i = 0; $i -lt $count; $i++) {
        $e = 6 + 16 * $i
        $size = [BitConverter]::ToInt32($ico, $e + 8)
        $offset = [BitConverter]::ToInt32($ico, $e + 12)
        $icons[$i] = New-Object byte[] $size
        [Array]::Copy($ico, $offset, $icons[$i], 0, $size)
        $ids[$i] = [uint16](1 + $i)
        $g = 6 + 14 * $i
        [Array]::Copy($ico, $e, $group, $g, 12)
        [BitConverter]::GetBytes($ids[$i]).CopyTo($group, $g + 12)
    }
    # Remove todos os ícones do node.exe; o nosso grupo fica como único.
    $old = @($existing)
}

[PeRes]::Write($Exe, $BlobName, $blob, $ids, $icons, $group, 'MAINICON', [string[]]$old)
Write-Host "Recursos gravados em $Exe"
