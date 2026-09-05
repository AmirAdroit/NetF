using Microsoft.VisualStudio.TestTools.UnitTesting;
using Netch.Services;
using System.Security.Principal;

namespace Tests;

[TestClass]
public class DesktopStartupServiceTests
{
    [TestMethod]
    public void MatchesQuotedDeviceAndCaseVariantPaths()
    {
        const string expected = @"C:\Program Files\NetF\NetF.exe";
        Assert.IsTrue(DesktopStartupService.PathsMatch("\"\\\\?\\C:\\Program Files\\NetF\\NetF.exe\"", expected));
        Assert.IsTrue(DesktopStartupService.PathsMatch(@"c:\PROGRAM FILES\netf\NETF.EXE", expected));
        Assert.IsFalse(DesktopStartupService.PathsMatch(@"C:\Portable\NetF.exe", expected));
    }

    [TestMethod]
    public void MatchesAccountNameAndSidWithoutTrustingUnrelatedPrincipals()
    {
        const string name = @"WORKSTATION\Amir";
        const string sid = "S-1-5-21-100-200-300-1001";
        Assert.IsTrue(DesktopStartupService.PrincipalsMatch(name, name, sid));
        Assert.IsTrue(DesktopStartupService.PrincipalsMatch(sid, name, sid));
        Assert.IsFalse(DesktopStartupService.PrincipalsMatch(null, name, sid));
        Assert.IsFalse(DesktopStartupService.PrincipalsMatch("S-1-5-18", name, sid));
    }

    [TestMethod]
    public void ResolvesTheCurrentShortAccountNameToItsSid()
    {
        using var identity = WindowsIdentity.GetCurrent();
        Assert.IsTrue(DesktopStartupService.PrincipalsMatch(
            Environment.UserName,
            identity.Name,
            identity.User?.Value));
    }
}
