// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract SwapToken is Initializable, OwnableUpgradeable, ReentrancyGuard {
    uint256 public feePercentage;
    address public treasury;

    enum RequestStatus { Pending, Approved, Rejected, Cancelled }
    struct SwapRequest {
        address requester;
        address acceptor;
        address tokenOffered;
        address tokenRequested;
        uint256 amountOffered;
        uint256 amountRequested;
        RequestStatus status;
    }

    SwapRequest[] public requests;

    event SwapRequestCreated(uint indexed requestId, address indexed requester, address indexed acceptor, address tokenOffered, address tokenRequested, uint256 amountOffered, uint256 amountRequested);
    event SwapRequestUpdated(uint indexed requestId, RequestStatus status);

    function initialize(address _treasury) public initializer {
        __Ownable_init(msg.sender);
        treasury = _treasury;
        feePercentage = 5;
    }

    function createSwapRequest(address _acceptor, address _tokenOffered, address _tokenRequested, uint256 _amountOffered, uint256 _amountRequested) external {
        require(_amountOffered > 0 && _amountRequested > 0, "Amounts must be greater than zero");
        IERC20(_tokenOffered).transferFrom(msg.sender, address(this), _amountOffered);
        SwapRequest memory newRequest = SwapRequest({
            requester: msg.sender,
            acceptor: _acceptor,
            tokenOffered: _tokenOffered,
            tokenRequested: _tokenRequested,
            amountOffered: _amountOffered,
            amountRequested: _amountRequested,
            status: RequestStatus.Pending
        });
        requests.push(newRequest);
        uint256 requestId = requests.length - 1;
        emit SwapRequestCreated(requestId, msg.sender, _acceptor, _tokenOffered, _tokenRequested, _amountOffered, _amountRequested);
    }

    function approveSwapRequest(uint _requestId) external nonReentrant {
        require(requests[_requestId].acceptor == msg.sender, "Only acceptor can approve");
        require(requests[_requestId].status == RequestStatus.Pending, "Request is not pending");
        
        SwapRequest storage request = requests[_requestId];
        IERC20(request.tokenRequested).transferFrom(msg.sender, address(this), request.amountRequested);
        uint256 feeOffered = request.amountOffered * feePercentage / 100;
        uint256 feeRequested = request.amountRequested * feePercentage / 100;
        uint256 amountOfferedAfterFee = request.amountOffered - feeOffered;
        uint256 amountRequestedAfterFee = request.amountRequested - feeRequested;

        IERC20(request.tokenOffered).transfer(request.acceptor, amountOfferedAfterFee);
        IERC20(request.tokenRequested).transfer(request.requester, amountRequestedAfterFee);
        IERC20(request.tokenOffered).transfer(treasury, feeOffered);
        IERC20(request.tokenRequested).transfer(treasury, feeRequested);

        request.status = RequestStatus.Approved;
        emit SwapRequestUpdated(_requestId, RequestStatus.Approved);
    }

    function rejectSwapRequest(uint _requestId) external {
        require(requests[_requestId].acceptor == msg.sender, "Only acceptor can reject");
        require(requests[_requestId].status == RequestStatus.Pending, "Request is not pending");
        
        SwapRequest storage request = requests[_requestId];
        IERC20(request.tokenOffered).transfer(request.requester, request.amountOffered);
        
        request.status = RequestStatus.Rejected;
        emit SwapRequestUpdated(_requestId, RequestStatus.Rejected);
    }

    function cancelSwapRequest(uint _requestId) external {
        require(requests[_requestId].requester == msg.sender, "Only requester can cancel");
        require(requests[_requestId].status == RequestStatus.Pending, "Request is not pending");
        
        SwapRequest storage request = requests[_requestId];
        IERC20(request.tokenOffered).transfer(request.requester, request.amountOffered);
        
        request.status = RequestStatus.Cancelled;
        emit SwapRequestUpdated(_requestId, RequestStatus.Cancelled);
    }

    function setTreasury(address _newTreasury) external onlyOwner {
        require(_newTreasury != address(0), "Invalid treasury address");
        treasury = _newTreasury;
    }

    function setFeePercentage(uint256 _newFeePercentage) external onlyOwner {
        feePercentage = _newFeePercentage;
    }
}