# Read global Windows GPU counters and match their LUIDs to DXGI adapter capacities.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class SparkleGpu {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct Desc {
  [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string Name;
  public uint Vendor, Device, Subsystem, Revision;
  public UIntPtr Dedicated, DedicatedSystem, Shared;
  public uint Low; public int High; public uint Flags;
 }
 [DllImport("dxgi.dll")] static extern int CreateDXGIFactory1(ref Guid iid, out IntPtr factory);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int EnumAdapter(IntPtr self,uint index,out IntPtr adapter);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int GetDesc(IntPtr self,out Desc desc);
 static T Method<T>(IntPtr self,int index) { return (T)(object)Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(Marshal.ReadIntPtr(self),index*IntPtr.Size),typeof(T)); }
 public static Desc[] Read() {
  var id=new Guid("770aae78-f26f-4dba-a829-253c83d1b387"); IntPtr factory;
  Marshal.ThrowExceptionForHR(CreateDXGIFactory1(ref id,out factory));var result=new List<Desc>();
  try { var enumerate=Method<EnumAdapter>(factory,12);for(uint i=0;i<32;i++){IntPtr adapter;int hr=enumerate(factory,i,out adapter);if(hr!=0)break;try{Desc desc;Marshal.ThrowExceptionForHR(Method<GetDesc>(adapter,10)(adapter,out desc));if((desc.Flags&2)==0)result.Add(desc);}finally{Marshal.Release(adapter);}} }
  finally{Marshal.Release(factory);}return result.ToArray();
 }
}
'@
$taskCounters = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory)
$taskAdapters = @([SparkleGpu]::Read() | ForEach-Object {
 $taskDesc = $_
 $taskLuid = 'luid_0x{0:X8}_0x{1:X8}_phys_0' -f ([uint32]([int64]$taskDesc.High -band 0xffffffff)), $taskDesc.Low
 $taskMatch = @($taskCounters | Where-Object { $_.Name -ieq $taskLuid })
 if ($taskMatch.Count -eq 1 -and $taskDesc.Dedicated.ToUInt64() -gt 1073741824) {
  $taskTotal = [double]$taskDesc.Dedicated.ToUInt64(); $taskUsed = [double]$taskMatch[0].DedicatedUsage
  [PSCustomObject]@{name=$taskDesc.Name; id=$taskLuid; totalBytes=$taskTotal; usedBytes=$taskUsed; freeBytes=[Math]::Max([double]0,$taskTotal-$taskUsed); sharedBytes=[double]$taskMatch[0].SharedUsage}
 }
})
if (-not $taskAdapters.Count) { throw 'Windows GPU counters could not be matched to a discrete adapter.' }
ConvertTo-Json -Compress -Depth 4 -InputObject ([PSCustomObject]@{available=$true; provider='Windows DXGI + global GPU counters'; adapters=$taskAdapters; at=[DateTime]::UtcNow.ToString('o')})
