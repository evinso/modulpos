const express = require('express');
const router = express.Router();
const prisma = require('../config/database');

// Get per-plan effective XML markup percentages from active global providers
router.get('/xml-plan-markup', async (req, res) => {
  try {
    const PLANS = ['Başlangıç', 'Profesyonel', 'Kurumsal'];
    const providers = await prisma.globalXmlProvider.findMany({
      where: { isActive: true },
      select: { priceMarkupPct: true, priceMarkupPctByPlan: true, priceMarkup: true }
    });

    // Aggregate: minimum effective markup per plan across all providers
    const result = {};
    PLANS.forEach(plan => {
      let min = null;
      for (const p of providers) {
        let eff = p.priceMarkupPct || 0;
        if (p.priceMarkupPctByPlan) {
          try {
            const byPlan = JSON.parse(p.priceMarkupPctByPlan);
            if (byPlan[plan] !== undefined && byPlan[plan] !== null && byPlan[plan] !== '') {
              eff = parseFloat(byPlan[plan]);
            }
          } catch {}
        }
        if (min === null || eff < min) min = eff;
      }
      if (min !== null) result[plan] = min;
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get landing page pricing plans
router.get('/pricing-plans', async (req, res) => {
  try {
    const plans = await prisma.landingPricingPlan.findMany({
      where: { isActive: true },
      orderBy: { order: 'asc' }
    });
    const formattedPlans = plans.map(p => ({
      ...p,
      features: JSON.parse(p.features || '[]')
    }));
    res.json(formattedPlans);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get landing page footer sections
router.get('/footer-sections', async (req, res) => {
  try {
    const sections = await prisma.landingFooterSection.findMany({
      where: { isActive: true },
      orderBy: { order: 'asc' }
    });
    
    const settings = await prisma.systemSettings.findMany({
      where: {
        key: {
          in: ['footer_description', 'footer_address', 'footer_email', 'footer_phone', 'footer_company_name', 'footer_copyright']
        }
      }
    });

    const settingsObj = {};
    settings.forEach(s => {
      settingsObj[s.key] = s.value;
    });

    // Parse links JSON
    const formattedSections = sections.map(s => ({
      ...s,
      links: JSON.parse(s.links || '[]')
    }));
    
    res.json({
      sections: formattedSections,
      settings: settingsObj
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /public/policy/:slug
router.get('/policy/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const [titleSetting, contentSetting] = await Promise.all([
      prisma.systemSettings.findUnique({ where: { key: `policy_${slug}_title` } }),
      prisma.systemSettings.findUnique({ where: { key: `policy_${slug}_content` } })
    ]);

    if (titleSetting && contentSetting) {
      return res.json({ slug, title: titleSetting.value, content: contentSetting.value });
    }
    res.status(404).json({ error: 'Sayfa bulunamadı' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
