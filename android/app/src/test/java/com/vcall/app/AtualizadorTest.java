package com.vcall.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class AtualizadorTest {
    @Test
    public void comparaNumeroPorNumero() {
        assertTrue(Atualizador.maisNova("3.7.4", "3.7.3"));
        assertTrue("10 > 9, não texto", Atualizador.maisNova("3.10.0", "3.9.2"));
        assertTrue(Atualizador.maisNova("4.0.0", "3.99.99"));
    }

    @Test
    public void igualOuMaisVelhaNaoAtualiza() {
        assertFalse(Atualizador.maisNova("3.7.3", "3.7.3"));
        assertFalse(Atualizador.maisNova("3.7.2", "3.7.3"));
        assertFalse(Atualizador.maisNova("3.7", "3.7.0"));
    }

    @Test
    public void sufixoNaoQuebra() {
        assertTrue(Atualizador.maisNova("3.8.0-beta", "3.7.9"));
        assertFalse(Atualizador.maisNova("lixo", "3.7.3"));
    }
}
