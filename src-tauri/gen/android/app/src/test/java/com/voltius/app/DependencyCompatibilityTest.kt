package com.voltius.app

import android.util.Base64
import app.tauri.plugin.Channel
import app.tauri.plugin.JSObject
import app.tauri.plugin.PluginManager
import com.fasterxml.jackson.databind.ObjectMapper
import com.google.crypto.tink.*
import com.google.crypto.tink.aead.AeadConfig
import com.google.crypto.tink.daead.DeterministicAeadConfig
import java.security.GeneralSecurityException
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Public synthetic fixtures made by Tink1.8; never reads a vault or Android Keystore. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [24, 35], manifest = Config.NONE)
class DependencyCompatibilityTest {
  @Before fun register() { AeadConfig.register(); DeterministicAeadConfig.register() }
  private fun bytes(value: String) = value.toByteArray(Charsets.UTF_8)
  private fun decoded(value: String) = Base64.decode(value, Base64.DEFAULT)
  private fun keyset(value: String): KeysetHandle =
    CleartextKeysetHandle.read(JsonKeysetReader.withString(String(decoded(value), Charsets.UTF_8)))

  @Test fun legacyAesGcmKeysetAndCiphertextStayReadable() {
    val aead = keyset("eyJwcmltYXJ5S2V5SWQiOjQyLCJrZXkiOlt7ImtleURhdGEiOnsidHlwZVVybCI6InR5cGUuZ29vZ2xlYXBpcy5jb20vZ29vZ2xlLmNyeXB0by50aW5rLkFlc0djbUtleSIsInZhbHVlIjoiR2lBSENBa0tDd3dORGc4UUVSSVRGQlVXRnhnWkdoc2NIUjRmSUNFaUl5UWxKZz09Iiwia2V5TWF0ZXJpYWxUeXBlIjoiU1lNTUVUUklDIn0sInN0YXR1cyI6IkVOQUJMRUQiLCJrZXlJZCI6NDIsIm91dHB1dFByZWZpeFR5cGUiOiJUSU5LIn1dfQ==").getPrimitive(Aead::class.java)
    val encrypted = decoded("AQAAACqxgyO3yhSztie06fQGBXIXG4tT+AaM56am1MZ3QoLbyPL9WooN1cunN8MlrDuW941vhW2C")
    assertArrayEquals(bytes("synthetic legacy payload"), aead.decrypt(encrypted, bytes("synthetic context")))
    assertThrows(GeneralSecurityException::class.java) { aead.decrypt(encrypted, bytes("wrong context")) }
  }

  @Test fun legacyDeterministicAesSivWireFormatIsUnchanged() {
    val aead = keyset("eyJwcmltYXJ5S2V5SWQiOjQyLCJrZXkiOlt7ImtleURhdGEiOnsidHlwZVVybCI6InR5cGUuZ29vZ2xlYXBpcy5jb20vZ29vZ2xlLmNyeXB0by50aW5rLkFlc1NpdktleSIsInZhbHVlIjoiRWtBSENBa0tDd3dORGc4UUVSSVRGQlVXRnhnWkdoc2NIUjRmSUNFaUl5UWxKaWNvS1NvckxDMHVMekF4TWpNME5UWTNPRGs2T3p3OVBqOUFRVUpEUkVWRyIsImtleU1hdGVyaWFsVHlwZSI6IlNZTU1FVFJJQyJ9LCJzdGF0dXMiOiJFTkFCTEVEIiwia2V5SWQiOjQyLCJvdXRwdXRQcmVmaXhUeXBlIjoiVElOSyJ9XX0=").getPrimitive(DeterministicAead::class.java)
    val encrypted = decoded("AQAAACqNCzm6tJxeAA4rbSJHkHgYo9m5a/q2FwHuuSESFqRP9v/LyXE205Iw")
    assertArrayEquals(bytes("synthetic legacy payload"), aead.decryptDeterministically(encrypted, bytes("synthetic context")))
    assertArrayEquals(encrypted, aead.encryptDeterministically(bytes("synthetic legacy payload"), bytes("synthetic context")))
    assertThrows(GeneralSecurityException::class.java) { aead.decryptDeterministically(encrypted, bytes("wrong context")) }
  }

  class BridgeArgs { var text: String = ""; var count: Int = 0 }

  @Test fun tauriConfiguredMapperPreservesJsonOrgAndChannelPayloads() {
    val field = PluginManager::class.java.getDeclaredField("jsonMapper").apply { isAccessible = true }
    val mapper = field.get(PluginManager) as ObjectMapper
    val text = "\u001b[31m红色🙂\u001b[0m"
    val payload = JSObject().put("text", text).put("count", 2)
    val encoded = mapper.writeValueAsString(payload)
    assertFalse(encoded.contains("nameValuePairs"))
    val args = mapper.readValue(encoded, BridgeArgs::class.java)
    assertEquals(text, args.text); assertEquals(2, args.count)
    var result: String? = null
    Channel(42, { result = it }, mapper).sendObject(payload)
    assertEquals(mapper.readTree(encoded), mapper.readTree(result!!))
  }
}
