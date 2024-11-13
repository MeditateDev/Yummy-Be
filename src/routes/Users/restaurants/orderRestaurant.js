const express = require("express");
const { asyncHandle } = require("../../../helper/asyncHandler");
const restaurantController = require("../../../controllers/Users/Restaurants/index.controller");
const { authorization } = require("../../../auth/authUtils");
const router = express.Router();

router.get(
  "/restaurant/order",
  authorization,
  asyncHandle(restaurantController.getOrder)
);
router.post("/restaurant/order/status",
  authorization,
  asyncHandle(restaurantController.changeStatusOrder)
)
module.exports = router;
